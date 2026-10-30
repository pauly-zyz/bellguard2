// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {Position} from "v4-core/src/libraries/Position.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";

import {GapCoverMath} from "./GapCoverMath.sol";
import {MarketCalendar} from "./MarketCalendar.sol";

/// @title BellguardHook
/// @notice Uniswap v4 hook for stock-token/USDG pools on Robinhood Chain.
///
/// While the stock market is closed (per MarketCalendar) it:
///  1. charges a visible surcharge on every swap, taken in the swap's
///     unspecified currency. USDG premiums go to the CoverVault; stock-token
///     premiums go to the treasury, which converts them and tops up the vault;
///  2. records LP flows per unit of active liquidity, the price at the start of
///     the window and the tick range traded. BellguardClaims uses these to value
///     each covered position's loss once the market has reopened.
///
/// It also stamps every position change, so only liquidity left untouched for
/// the whole window can claim.
contract BellguardHook is IHooks, Ownable2Step {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice LP flows are stored per unit of liquidity, scaled by this.
    int256 public constant FLOW_SCALE = 1e18;
    /// @notice Hard ceiling on the surcharge: 3% of the swap's unspecified amount.
    uint256 public constant MAX_SURCHARGE_BPS = 300;

    struct PoolConfig {
        bool registered;
        bool stockIs0;
        address stock;
    }

    /// @notice What happened in one pool during one closed window.
    struct WindowState {
        bool started; // at least one swap while closed
        uint160 sqrtPriceStart; // pool price before the first closed-window swap
        int24 tickStart;
        int24 minTick; // lowest tick reached during the window
        int24 maxTick; // highest tick reached during the window
        uint32 swaps;
        int256 stockFlowPerL; // sum of (stock received by LPs) * FLOW_SCALE / liquidity
        int256 quoteFlowPerL; // sum of (quote received by LPs) * FLOW_SCALE / liquidity
        uint256 premiumQuote; // USDG premium sent to the vault
        uint256 premiumStock; // stock premium sent to the treasury
    }

    IPoolManager public immutable poolManager;
    MarketCalendar public immutable calendar;
    Currency public immutable quote; // USDG, the vault's asset
    address public immutable vault;

    address public treasury;
    uint16 public closedBps;
    uint16 public openBps;

    /// @notice Chainlink feed per stock token. Only registered stocks can have Bellguard pools.
    mapping(address stock => address feed) public stockFeed;
    mapping(PoolId => PoolConfig) public pools;
    mapping(PoolId => mapping(uint256 windowIndex => WindowState)) internal _windows;
    /// @notice Last time each position was changed (v4 position key).
    mapping(PoolId => mapping(bytes32 positionKey => uint256)) public lastModified;

    event StockRegistered(address indexed stock, address feed);
    event RatesSet(uint16 closedBps, uint16 openBps);
    event TreasurySet(address treasury);
    event PoolRegistered(PoolId indexed id, address stock, bool stockIs0);
    event PremiumTaken(PoolId indexed id, uint256 indexed windowIndex, Currency currency, uint256 amount, address to);

    error NotPoolManager();
    error UnsupportedPool();
    error RateTooHigh();
    error ZeroAddress();
    error HookNotImplemented();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    constructor(
        IPoolManager poolManager_,
        MarketCalendar calendar_,
        Currency quote_,
        address vault_,
        address treasury_,
        uint16 closedBps_,
        address owner_
    ) Ownable(owner_) {
        if (vault_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (closedBps_ > MAX_SURCHARGE_BPS) revert RateTooHigh();
        poolManager = poolManager_;
        calendar = calendar_;
        quote = quote_;
        vault = vault_;
        treasury = treasury_;
        closedBps = closedBps_;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ------------------------------------------------------------------ admin

    function registerStock(address stock, address feed) external onlyOwner {
        if (stock == address(0) || feed == address(0)) revert ZeroAddress();
        stockFeed[stock] = feed;
        emit StockRegistered(stock, feed);
    }

    function setRates(uint16 closedBps_, uint16 openBps_) external onlyOwner {
        if (closedBps_ > MAX_SURCHARGE_BPS || openBps_ > MAX_SURCHARGE_BPS) revert RateTooHigh();
        closedBps = closedBps_;
        openBps = openBps_;
        emit RatesSet(closedBps_, openBps_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    // ------------------------------------------------------------------ views

    function window(PoolId id, uint256 windowIndex) external view returns (WindowState memory) {
        return _windows[id][windowIndex];
    }

    /// @notice Surcharge in bps that a swap in this pool would pay right now.
    function currentSurchargeBps(PoolKey calldata key) public view returns (uint256) {
        PoolConfig memory cfg = pools[key.toId()];
        (bool closed,,) = calendar.closureAt(block.timestamp);
        uint256 mult = calendar.riskMultiplierBps(cfg.stock, block.timestamp);
        return GapCoverMath.surchargeBps(closed, mult, closedBps, openBps, MAX_SURCHARGE_BPS);
    }

    // ------------------------------------------------------------------ hooks

    function beforeInitialize(address, PoolKey calldata key, uint160) external onlyPoolManager returns (bytes4) {
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        address q = Currency.unwrap(quote);
        address stock;
        bool stockIs0;
        if (c1 == q && stockFeed[c0] != address(0)) {
            (stock, stockIs0) = (c0, true);
        } else if (c0 == q && stockFeed[c1] != address(0)) {
            (stock, stockIs0) = (c1, false);
        } else {
            revert UnsupportedPool();
        }
        PoolId id = key.toId();
        pools[id] = PoolConfig({registered: true, stockIs0: stockIs0, stock: stock});
        emit PoolRegistered(id, stock, stockIs0);
        return IHooks.beforeInitialize.selector;
    }

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata
    ) external onlyPoolManager returns (bytes4) {
        _stamp(sender, key, params);
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata
    ) external onlyPoolManager returns (bytes4) {
        _stamp(sender, key, params);
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        (bool closed, uint256 idx,) = calendar.closureAt(block.timestamp);
        if (closed) {
            PoolId id = key.toId();
            WindowState storage w = _windows[id][idx];
            if (!w.started) {
                (uint160 sqrtPriceX96, int24 tick,,) = poolManager.getSlot0(id);
                w.started = true;
                w.sqrtPriceStart = sqrtPriceX96;
                w.tickStart = tick;
                w.minTick = tick;
                w.maxTick = tick;
            }
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        PoolId id = key.toId();
        PoolConfig memory cfg = pools[id];
        (bool closed, uint256 idx,) = calendar.closureAt(block.timestamp);

        if (closed) _record(id, cfg, idx, delta);

        // Surcharge on the unspecified side of the swap.
        uint256 mult = calendar.riskMultiplierBps(cfg.stock, block.timestamp);
        uint256 bps = GapCoverMath.surchargeBps(closed, mult, closedBps, openBps, MAX_SURCHARGE_BPS);
        if (bps == 0) return (IHooks.afterSwap.selector, 0);

        bool specifiedIs0 = (params.amountSpecified < 0) == params.zeroForOne;
        (Currency feeCurrency, int128 amount) =
            specifiedIs0 ? (key.currency1, delta.amount1()) : (key.currency0, delta.amount0());
        uint256 abs = uint256(uint128(amount < 0 ? -amount : amount));
        uint256 fee = abs * bps / 10_000;
        if (fee == 0) return (IHooks.afterSwap.selector, 0);

        address to = feeCurrency == quote ? vault : treasury;
        poolManager.take(feeCurrency, to, fee);
        if (closed) {
            WindowState storage w = _windows[id][idx];
            if (feeCurrency == quote) w.premiumQuote += fee;
            else w.premiumStock += fee;
        }
        emit PremiumTaken(id, idx, feeCurrency, fee, to);
        // forge-lint: disable-next-line(unsafe-typecast) fee <= abs < 2^127
        return (IHooks.afterSwap.selector, int128(int256(fee)));
    }

    // --------------------------------------------------------------- internal

    function _stamp(address sender, PoolKey calldata key, IPoolManager.ModifyLiquidityParams calldata p) private {
        bytes32 posKey = Position.calculatePositionKey(sender, p.tickLower, p.tickUpper, p.salt);
        lastModified[key.toId()][posKey] = block.timestamp;
    }

    function _record(PoolId id, PoolConfig memory cfg, uint256 idx, BalanceDelta delta) private {
        WindowState storage w = _windows[id][idx];
        (, int24 tick,,) = poolManager.getSlot0(id);
        if (tick < w.minTick) w.minTick = tick;
        if (tick > w.maxTick) w.maxTick = tick;
        w.swaps += 1;

        uint128 liquidity = poolManager.getLiquidity(id);
        if (liquidity == 0) return;
        // `delta` is the swapper's balance change; LPs receive the opposite.
        int256 lp0 = -int256(delta.amount0());
        int256 lp1 = -int256(delta.amount1());
        (int256 stockFlow, int256 quoteFlow) = cfg.stockIs0 ? (lp0, lp1) : (lp1, lp0);
        int256 l = int256(uint256(liquidity));
        w.stockFlowPerL += stockFlow * FLOW_SCALE / l;
        w.quoteFlowPerL += quoteFlow * FLOW_SCALE / l;
    }

    // ------------------------------------------------- unused hook callbacks

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }
}
