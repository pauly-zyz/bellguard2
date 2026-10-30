// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Position} from "v4-core/src/libraries/Position.sol";
import {SqrtPriceMath} from "v4-core/src/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";

import {BellguardHook} from "./BellguardHook.sol";
import {CoverVault} from "./CoverVault.sol";
import {GapCoverMath} from "./GapCoverMath.sol";
import {MarketCalendar} from "./MarketCalendar.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @title BellguardClaims
/// @notice Settles closed windows against Chainlink and pays LPs.
///
/// Timeline for closed window `w` (ends at the reopen, `w.end`):
///   w.end + settleDelay                  settlement opens: the stock's Chainlink
///                                        price after reopen fixes each pool's
///                                        loss per unit of liquidity
///   ... + settleSlot                     permissionless settlement closes
///                                        (owner can still settle until the deadline)
///   w.end + settleDelay + claimPeriod    claim deadline; payouts open
///
/// A position can claim for a window if it was not modified from before the
/// window started until it claims, and its range covered every tick the pool
/// traded during the window. Payout follows GapCoverMath.payout (deductible and
/// cap), scaled pro rata if the window's claims exceed its budget.
contract BellguardClaims is Ownable2Step, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    struct Terms {
        uint16 deductibleBps; // of position notional
        uint16 capBps; // of position notional
        uint16 maxWindowBps; // of vault assets, per closed window (all pools)
    }

    struct PoolSettlement {
        bool settled;
        uint256 price; // quote raw units per 1e18 stock raw units
        int256 markoutPerL; // LP P&L per unit liquidity, quote raw units scaled by FLOW_SCALE
    }

    struct WindowBudget {
        bool snapshotted;
        uint256 budget; // max total payout for this window
        uint256 totalClaims; // sum of registered claims
    }

    struct Claim {
        address recipient;
        bool paid;
        uint256 windowIndex;
        uint256 amount; // before pro rata
    }

    uint256 public constant PRICE_SCALE = 1e18;

    BellguardHook public immutable hook;
    CoverVault public immutable vault;
    MarketCalendar public immutable calendar;
    IPoolManager public immutable poolManager;
    /// @notice Uniswap v4 PositionManager: positions it holds are claimed by the NFT owner.
    address public immutable positionManager;

    uint256 public immutable settleDelay;
    uint256 public immutable settleSlot;
    uint256 public immutable claimPeriod;
    uint256 public immutable maxPriceAge;

    Terms public terms;

    mapping(PoolId => mapping(uint256 windowIndex => PoolSettlement)) public settlements;
    mapping(uint256 windowIndex => WindowBudget) public budgets;
    mapping(bytes32 claimId => Claim) public claims;

    event TermsSet(uint16 deductibleBps, uint16 capBps, uint16 maxWindowBps);
    event Settled(PoolId indexed id, uint256 indexed windowIndex, uint256 price, int256 markoutPerL);
    event ClaimRegistered(
        bytes32 indexed claimId, PoolId indexed id, uint256 indexed windowIndex, address recipient, uint256 amount
    );
    event ClaimPaid(bytes32 indexed claimId, address recipient, uint256 amount);

    error WindowNotOver();
    error TooEarly();
    error TooLate();
    error SettleSlotClosed();
    error AlreadySettled();
    error NotSettled();
    error UnknownPool();
    error BadPrice();
    error StalePrice();
    error NotPositionOwner();
    error PositionChanged();
    error OutOfRange();
    error NothingToClaim();
    error AlreadyClaimed();
    error AlreadyPaid();
    error BadTerms();
    error LockTooShort();

    constructor(
        BellguardHook hook_,
        CoverVault vault_,
        address positionManager_,
        uint256 settleDelay_,
        uint256 settleSlot_,
        uint256 claimPeriod_,
        uint256 maxPriceAge_,
        Terms memory terms_,
        address owner_
    ) Ownable(owner_) {
        if (vault_.lockAfterReopen() < settleDelay_ + claimPeriod_) revert LockTooShort();
        hook = hook_;
        vault = vault_;
        calendar = hook_.calendar();
        poolManager = hook_.poolManager();
        positionManager = positionManager_;
        settleDelay = settleDelay_;
        settleSlot = settleSlot_;
        claimPeriod = claimPeriod_;
        maxPriceAge = maxPriceAge_;
        _setTerms(terms_);
    }

    function setTerms(Terms calldata terms_) external onlyOwner {
        _setTerms(terms_);
    }

    function _setTerms(Terms memory t) private {
        if (t.deductibleBps > 10_000 || t.capBps > 10_000 || t.maxWindowBps > 10_000) revert BadTerms();
        terms = t;
        emit TermsSet(t.deductibleBps, t.capBps, t.maxWindowBps);
    }

    // ------------------------------------------------------------ settlement

    /// @notice Fix a pool's loss for a closed window from the Chainlink price after reopen.
    function settle(PoolKey calldata key, uint256 windowIndex) external {
        PoolId id = key.toId();
        (bool registered, bool stockIs0, address stock) = hook.pools(id);
        if (!registered) revert UnknownPool();
        PoolSettlement storage s = settlements[id][windowIndex];
        if (s.settled) revert AlreadySettled();

        MarketCalendar.Window memory w = calendar.closure(windowIndex);
        uint256 opens = uint256(w.end) + settleDelay;
        if (block.timestamp < opens) revert TooEarly();
        if (block.timestamp >= opens + claimPeriod) revert TooLate();
        if (block.timestamp >= opens + settleSlot && msg.sender != owner()) revert SettleSlotClosed();

        uint256 price = _price(stock, w.end, stockIs0 ? key.currency0 : key.currency1, stockIs0 ? key.currency1 : key.currency0);

        BellguardHook.WindowState memory ws = hook.window(id, windowIndex);
        // markout = stockFlow * price + quoteFlow   (all per unit of liquidity)
        int256 markout = ws.stockFlowPerL * int256(price) / int256(PRICE_SCALE) + ws.quoteFlowPerL;

        s.settled = true;
        s.price = price;
        s.markoutPerL = markout;

        WindowBudget storage b = budgets[windowIndex];
        if (!b.snapshotted) {
            b.snapshotted = true;
            b.budget = vault.totalAssets() * terms.maxWindowBps / 10_000;
        }
        emit Settled(id, windowIndex, price, markout);
    }

    /// @dev Chainlink USD price converted to quote raw units per 1e18 stock raw units.
    function _price(address stock, uint64 windowEnd, Currency stockC, Currency quoteC) private view returns (uint256) {
        IAggregatorV3 feed = IAggregatorV3(hook.stockFeed(stock));
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert BadPrice();
        // The feed must have updated after the reopen, and recently.
        if (updatedAt < windowEnd || block.timestamp - updatedAt > maxPriceAge) revert StalePrice();
        uint256 feedDec = feed.decimals();
        uint256 stockDec = IERC20Metadata(Currency.unwrap(stockC)).decimals();
        uint256 quoteDec = IERC20Metadata(Currency.unwrap(quoteC)).decimals();
        // price per stock raw unit = answer / 10^feedDec * 10^quoteDec / 10^stockDec
        return uint256(answer) * PRICE_SCALE * 10 ** quoteDec / 10 ** (feedDec + stockDec);
    }

    // ----------------------------------------------------------------- claims

    /// @notice A Uniswap v4 position. `owner` is the PositionManager for NFT positions,
    ///         otherwise the address that called modifyLiquidity (must be the claimant).
    struct PositionRef {
        address owner;
        int24 tickLower;
        int24 tickUpper;
        bytes32 salt;
    }

    /// @notice Register a claim for one position and one settled window.
    function registerClaim(PoolKey calldata key, uint256 windowIndex, PositionRef calldata p)
        external
        returns (bytes32 claimId, uint256 amount)
    {
        PoolId id = key.toId();
        if (!settlements[id][windowIndex].settled) revert NotSettled();
        MarketCalendar.Window memory w = calendar.closure(windowIndex);
        if (block.timestamp >= _deadline(w)) revert TooLate();
        _checkClaimant(p);

        bytes32 posKey = Position.calculatePositionKey(p.owner, p.tickLower, p.tickUpper, p.salt);
        uint256 changed = hook.lastModified(id, posKey);
        if (changed == 0 || changed >= w.start) revert PositionChanged();

        claimId = keccak256(abi.encode(id, windowIndex, posKey));
        if (claims[claimId].recipient != address(0)) revert AlreadyClaimed();

        amount = _claimAmount(key, id, windowIndex, posKey, p);
        if (amount == 0) revert NothingToClaim();

        claims[claimId] = Claim({recipient: msg.sender, paid: false, windowIndex: windowIndex, amount: amount});
        budgets[windowIndex].totalClaims += amount;
        emit ClaimRegistered(claimId, id, windowIndex, msg.sender, amount);
    }

    /// @notice What a position would be owed for a settled window (before pro rata).
    function quoteClaim(PoolKey calldata key, uint256 windowIndex, PositionRef calldata p)
        external
        view
        returns (uint256)
    {
        PoolId id = key.toId();
        if (!settlements[id][windowIndex].settled) return 0;
        bytes32 posKey = Position.calculatePositionKey(p.owner, p.tickLower, p.tickUpper, p.salt);
        uint256 changed = hook.lastModified(id, posKey);
        if (changed == 0 || changed >= calendar.closure(windowIndex).start) return 0;
        return _claimAmount(key, id, windowIndex, posKey, p);
    }

    function _checkClaimant(PositionRef calldata p) private view {
        if (p.owner == positionManager) {
            if (IERC721(positionManager).ownerOf(uint256(p.salt)) != msg.sender) revert NotPositionOwner();
        } else if (p.owner != msg.sender) {
            revert NotPositionOwner();
        }
    }

    function _claimAmount(PoolKey calldata key, PoolId id, uint256 windowIndex, bytes32 posKey, PositionRef calldata p)
        private
        view
        returns (uint256)
    {
        PoolSettlement memory s = settlements[id][windowIndex];
        BellguardHook.WindowState memory ws = hook.window(id, windowIndex);
        if (!ws.started || s.markoutPerL >= 0) return 0;
        if (p.tickLower > ws.minTick || p.tickUpper <= ws.maxTick) revert OutOfRange();

        uint128 liquidity = poolManager.getPositionLiquidity(id, posKey);
        uint256 loss = uint256(-s.markoutPerL) * liquidity / uint256(hook.FLOW_SCALE());
        uint256 notional = _notional(key, ws.sqrtPriceStart, p, liquidity, s.price);
        return GapCoverMath.payout(loss, notional, terms.deductibleBps, terms.capBps);
    }

    /// @notice Pay a registered claim after the claim deadline, pro rata if needed.
    function payClaim(bytes32 claimId) external nonReentrant returns (uint256 paid) {
        Claim storage c = claims[claimId];
        if (c.recipient == address(0)) revert NothingToClaim();
        if (c.paid) revert AlreadyPaid();
        if (block.timestamp < _deadline(calendar.closure(c.windowIndex))) revert TooEarly();
        WindowBudget memory b = budgets[c.windowIndex];
        paid = b.totalClaims <= b.budget ? c.amount : c.amount * b.budget / b.totalClaims;
        c.paid = true;
        vault.payClaim(c.recipient, paid);
        emit ClaimPaid(claimId, c.recipient, paid);
    }

    // ------------------------------------------------------------------ views

    function claimDeadline(uint256 windowIndex) external view returns (uint256) {
        return _deadline(calendar.closure(windowIndex));
    }

    function _deadline(MarketCalendar.Window memory w) private view returns (uint256) {
        return uint256(w.end) + settleDelay + claimPeriod;
    }

    /// @dev Position value (in quote raw units) at the window's opening price.
    function _notional(PoolKey calldata key, uint160 sqrtP, PositionRef calldata p, uint128 liquidity, uint256 price)
        private
        view
        returns (uint256)
    {
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(p.tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(p.tickUpper);
        uint256 amount0 = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtB, liquidity, false);
        uint256 amount1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtP, liquidity, false);
        (bool registered, bool stockIs0,) = hook.pools(key.toId());
        if (!registered) revert UnknownPool();
        (uint256 stockAmt, uint256 quoteAmt) = stockIs0 ? (amount0, amount1) : (amount1, amount0);
        return stockAmt * price / PRICE_SCALE + quoteAmt;
    }
}
