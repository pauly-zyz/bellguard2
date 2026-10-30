// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";

import {BellguardClaims} from "../src/BellguardClaims.sol";
import {BellguardHook} from "../src/BellguardHook.sol";
import {CoverVault} from "../src/CoverVault.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";

contract MockAggregator {
    int256 public answer;
    uint256 public updatedAt;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "Robinhood TEST / USD";
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract BellguardTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;

    uint64 constant T0 = 1_791_590_400; // 2026-10-10 00:00 UTC, a Saturday 02:00 Berlin
    uint64 constant T1 = T0 + 48 hours; // reopen
    int24 constant SPACING = 60;
    int256 constant LIQ = 4e17; // ~$1M per side over a +/-6000 tick range
    uint160 constant HOOK_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
        | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;

    MockERC20 usdg;
    MockERC20 stock;
    MockAggregator feed;
    MarketCalendar calendar;
    CoverVault vault;
    BellguardHook hook;
    BellguardClaims claims;

    address treasury = makeAddr("treasury");
    address underwriter = makeAddr("underwriter");
    PoolKey poolKey;
    bool stockIs0;
    int24 tickAt100;
    int24 lower;
    int24 upper;

    function setUp() public {
        vm.warp(T0 - 3 days);
        deployFreshManagerAndRouters();

        // Place tokens at fixed addresses so each orientation is tested on purpose.
        (address usdgAt, address stockAt) = _stockFirst()
            ? (address(uint160(0xF << 156) + 1), address(uint160(1 << 156) + 1))
            : (address(uint160(1 << 156) + 2), address(uint160(0xF << 156) + 2));
        deployCodeTo("MockERC20.sol:MockERC20", abi.encode("USDG", "USDG", uint8(6)), usdgAt);
        deployCodeTo("MockERC20.sol:MockERC20", abi.encode("Test Stock", "TEST", uint8(18)), stockAt);
        usdg = MockERC20(usdgAt);
        stock = MockERC20(stockAt);
        feed = new MockAggregator();
        feed.set(100e8, block.timestamp);

        calendar = new MarketCalendar(address(this), 1 hours);
        MarketCalendar.Window[] memory ws = new MarketCalendar.Window[](2);
        ws[0] = MarketCalendar.Window(T0, T1);
        ws[1] = MarketCalendar.Window(T0 + 7 days, T1 + 7 days);
        calendar.addClosures(ws);

        vault = new CoverVault(IERC20(address(usdg)), calendar, 3 days, address(this));

        address hookAddr = address(HOOK_FLAGS | (uint160(0x4444) << 144));
        deployCodeTo(
            "BellguardHook.sol:BellguardHook",
            abi.encode(manager, calendar, Currency.wrap(address(usdg)), address(vault), treasury, uint16(50), address(this)),
            hookAddr
        );
        hook = BellguardHook(hookAddr);
        hook.registerStock(address(stock), address(feed));

        claims = new BellguardClaims(
            hook,
            vault,
            address(0xdead), // no PositionManager in this test
            1 hours, // settleDelay
            1 hours, // settleSlot
            1 days, // claimPeriod
            1 hours, // maxPriceAge
            BellguardClaims.Terms({deductibleBps: 0, capBps: 500, maxWindowBps: 2000}),
            address(this)
        );
        vault.setClaims(address(claims));

        // Underwriter funds the vault with 1M USDG.
        usdg.mint(underwriter, 1_000_000e6);
        vm.startPrank(underwriter);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(1_000_000e6, underwriter);
        vm.stopPrank();

        // Trader / LP balances
        usdg.mint(address(this), 100_000_000e6);
        stock.mint(address(this), 1_000_000e18);
        usdg.approve(address(swapRouter), type(uint256).max);
        stock.approve(address(swapRouter), type(uint256).max);
        usdg.approve(address(modifyLiquidityRouter), type(uint256).max);
        stock.approve(address(modifyLiquidityRouter), type(uint256).max);

        // Pool at ~$100 per stock token
        stockIs0 = address(stock) < address(usdg);
        (Currency c0, Currency c1) = stockIs0
            ? (Currency.wrap(address(stock)), Currency.wrap(address(usdg)))
            : (Currency.wrap(address(usdg)), Currency.wrap(address(stock)));
        // raw price token1/token0: stock->usdg = 100e6/1e18 = 1e-10 => tick ~ -230259
        tickAt100 = stockIs0 ? int24(-230280) : int24(230280);
        (poolKey,) = initPool(c0, c1, IHooks(hookAddr), 3000, SPACING, TickMath.getSqrtPriceAtTick(tickAt100));
        lower = tickAt100 - 6000;
        upper = tickAt100 + 6000;
        _addLiquidity(lower, upper, LIQ, bytes32(0));
    }

    // ---------------------------------------------------------------- helpers

    /// Overridden by BellguardTestStockFirst to flip the token order.
    function _stockFirst() internal pure virtual returns (bool) {
        return false;
    }

    function _addLiquidity(int24 lo, int24 hi, int256 liq, bytes32 salt) internal {
        modifyLiquidityRouter.modifyLiquidity(
            poolKey, IPoolManager.ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: liq, salt: salt}), ""
        );
    }

    /// Buy stock with `usdgIn` USDG (exact input).
    function _buyStock(uint256 usdgIn) internal {
        bool zeroForOne = !stockIs0; // paying USDG
        swap(poolKey, zeroForOne, -int256(usdgIn), "");
    }

    function _position(int24 lo, int24 hi, bytes32 salt) internal view returns (BellguardClaims.PositionRef memory) {
        return BellguardClaims.PositionRef({owner: address(modifyLiquidityRouter), tickLower: lo, tickUpper: hi, salt: salt});
    }

    // ------------------------------------------------------------------ tests

    function test_orientation() public view {
        assertEq(stockIs0, _stockFirst());
    }

    function test_hookAddressAndPoolRegistered() public view {
        (bool registered, bool is0, address s) = hook.pools(poolKey.toId());
        assertTrue(registered);
        assertEq(is0, stockIs0);
        assertEq(s, address(stock));
    }

    function test_rejectsPoolWithoutRegisteredStock() public {
        MockERC20 other = new MockERC20("X", "X", 18);
        (Currency c0, Currency c1) = address(other) < address(usdg)
            ? (Currency.wrap(address(other)), Currency.wrap(address(usdg)))
            : (Currency.wrap(address(usdg)), Currency.wrap(address(other)));
        PoolKey memory k = PoolKey(c0, c1, 3000, SPACING, IHooks(address(hook)));
        vm.expectRevert();
        manager.initialize(k, TickMath.getSqrtPriceAtTick(0));
    }

    function test_noSurchargeWhileOpen() public {
        uint256 before = usdg.balanceOf(address(vault));
        _buyStock(10_000e6);
        assertEq(usdg.balanceOf(address(vault)), before);
        assertEq(hook.currentSurchargeBps(poolKey), 0);
    }

    function test_surchargeWhileClosedGoesToVaultOrTreasury() public {
        vm.warp(T0 + 1 hours);
        assertEq(hook.currentSurchargeBps(poolKey), 50);
        // Exact-input USDG: unspecified side is the stock -> premium in stock to treasury
        _buyStock(10_000e6);
        assertGt(stock.balanceOf(treasury), 0);
        // Exact-input stock (sell): unspecified side is USDG -> premium to vault
        uint256 before = usdg.balanceOf(address(vault));
        swap(poolKey, stockIs0, -int256(10e18), "");
        uint256 premium = usdg.balanceOf(address(vault)) - before;
        // ~0.5% of ~$1000 of output
        assertApproxEqRel(premium, 5e6, 0.05e18);

        BellguardHook.WindowState memory w = hook.window(poolKey.toId(), 0);
        assertTrue(w.started);
        assertEq(w.swaps, 2);
        assertEq(w.premiumQuote, premium);
    }

    function test_earningsMultiplier() public {
        calendar.addEvent(address(stock), MarketCalendar.EventWindow(T0, T0 + 1 days, 30_000));
        vm.warp(T0 + 1 hours);
        assertEq(hook.currentSurchargeBps(poolKey), 150);
    }

    function test_vaultLockedWhileClosedAndDuringClaims() public {
        vm.warp(T0 - 2 hours);
        assertFalse(vault.isLocked());
        vm.warp(T0 + 1);
        assertTrue(vault.isLocked());
        assertEq(vault.maxWithdraw(underwriter), 0);
        vm.prank(underwriter);
        vm.expectRevert(); // ERC4626ExceededMaxWithdraw: maxWithdraw is 0 while locked
        vault.withdraw(1e6, underwriter, underwriter);
        vm.warp(T1 + 2 days); // still in lockAfterReopen (3 days)
        assertTrue(vault.isLocked());
        vm.warp(T1 + 3 days + 1);
        assertFalse(vault.isLocked());
        vm.prank(underwriter);
        vault.withdraw(1e6, underwriter, underwriter);
    }

    /// Full cycle: weekend buyers take stock at ~$100-101, Monday reopens at $110.
    function test_fullCycle_gapUp_lpPaid() public {
        vm.warp(T0 + 1 hours);
        for (uint256 i; i < 5; ++i) {
            _buyStock(20_000e6);
        }
        BellguardHook.WindowState memory w = hook.window(poolKey.toId(), 0);
        assertTrue(w.started);
        assertEq(w.swaps, 5);

        // Reopen + settle delay: Chainlink shows $110
        vm.warp(T1 + 1 hours);
        feed.set(110e8, block.timestamp);
        claims.settle(poolKey, 0);
        (bool settled, uint256 price, int256 markout) = claims.settlements(poolKey.toId(), 0);
        assertTrue(settled);
        assertEq(price, 110e6); // 110 USDG (6 dec) per 1e18 stock
        assertLt(markout, 0, "LPs sold stock below the reopen price");

        BellguardClaims.PositionRef memory pos = _position(lower, upper, bytes32(0));
        uint256 quoted = claims.quoteClaim(poolKey, 0, pos);
        assertGt(quoted, 0);

        vm.prank(address(modifyLiquidityRouter));
        (bytes32 claimId, uint256 amount) = claims.registerClaim(poolKey, 0, pos);
        assertEq(amount, quoted);

        // Can't pay before the deadline, nor claim twice
        vm.expectRevert(BellguardClaims.TooEarly.selector);
        claims.payClaim(claimId);
        vm.prank(address(modifyLiquidityRouter));
        vm.expectRevert(BellguardClaims.AlreadyClaimed.selector);
        claims.registerClaim(poolKey, 0, pos);

        vm.warp(claims.claimDeadline(0));
        uint256 before = usdg.balanceOf(address(modifyLiquidityRouter));
        uint256 paid = claims.payClaim(claimId);
        assertEq(paid, amount); // budget (20% of vault) not exceeded
        assertEq(usdg.balanceOf(address(modifyLiquidityRouter)) - before, amount);

        vm.expectRevert(BellguardClaims.AlreadyPaid.selector);
        claims.payClaim(claimId);
    }

    /// Payout must roughly match an independent estimate of the LP loss.
    function test_lossMatchesDirectEstimate() public {
        vm.warp(T0 + 1 hours);
        uint256 stockBefore = _poolStock();
        uint256 usdgBefore = _poolUsdg();
        _buyStock(50_000e6);
        uint256 stockOut = stockBefore - _poolStock(); // stock LPs gave up (hook premium excluded)
        uint256 usdgIn = _poolUsdg() - usdgBefore;

        vm.warp(T1 + 1 hours);
        feed.set(110e8, block.timestamp);
        claims.settle(poolKey, 0);
        uint256 amount = claims.quoteClaim(poolKey, 0, _position(lower, upper, bytes32(0)));

        // Direct: value given away at $110 minus USDG received
        uint256 direct = stockOut * 110e6 / 1e18 - usdgIn;
        assertApproxEqRel(amount, direct, 0.02e18);
    }

    function _poolStock() internal view returns (uint256) {
        return stock.balanceOf(address(manager));
    }

    function _poolUsdg() internal view returns (uint256) {
        return usdg.balanceOf(address(manager));
    }

    function test_noClaimWhenLpsGained() public {
        vm.warp(T0 + 1 hours);
        _buyStock(50_000e6);
        vm.warp(T1 + 1 hours);
        feed.set(95e8, block.timestamp); // reopened lower: weekend buyers overpaid
        claims.settle(poolKey, 0);
        (,, int256 markout) = claims.settlements(poolKey.toId(), 0);
        assertGt(markout, 0);
        vm.prank(address(modifyLiquidityRouter));
        vm.expectRevert(BellguardClaims.NothingToClaim.selector);
        claims.registerClaim(poolKey, 0, _position(lower, upper, bytes32(0)));
    }

    function test_positionChangedDuringWindowCannotClaim() public {
        vm.warp(T0 + 1 hours);
        _addLiquidity(lower, upper, 1e12, bytes32(0)); // top-up during the window
        _buyStock(50_000e6);
        vm.warp(T1 + 1 hours);
        feed.set(110e8, block.timestamp);
        claims.settle(poolKey, 0);
        vm.prank(address(modifyLiquidityRouter));
        vm.expectRevert(BellguardClaims.PositionChanged.selector);
        claims.registerClaim(poolKey, 0, _position(lower, upper, bytes32(0)));
    }

    function test_justInTimeLiquidityCannotClaim() public {
        vm.warp(T0 + 1 hours);
        _buyStock(50_000e6);
        vm.warp(T1 - 10 minutes);
        _addLiquidity(lower, upper, LIQ, bytes32(uint256(7))); // added late in the window
        vm.warp(T1 + 1 hours);
        feed.set(110e8, block.timestamp);
        claims.settle(poolKey, 0);
        vm.prank(address(modifyLiquidityRouter));
        vm.expectRevert(BellguardClaims.PositionChanged.selector);
        claims.registerClaim(poolKey, 0, _position(lower, upper, bytes32(uint256(7))));
    }

    function test_narrowPositionOutOfRangeCannotClaim() public {
        int24 lo = tickAt100 - 60;
        int24 hi = tickAt100 + 60;
        _addLiquidity(lo, hi, 1e12, bytes32(uint256(1)));
        vm.warp(T0 + 1 hours);
        _buyStock(200_000e6); // pushes price out of the narrow range
        vm.warp(T1 + 1 hours);
        feed.set(110e8, block.timestamp);
        claims.settle(poolKey, 0);
        vm.prank(address(modifyLiquidityRouter));
        vm.expectRevert(BellguardClaims.OutOfRange.selector);
        claims.registerClaim(poolKey, 0, _position(lo, hi, bytes32(uint256(1))));
    }

    function test_onlyPositionOwnerCanClaim() public {
        vm.warp(T0 + 1 hours);
        _buyStock(50_000e6);
        vm.warp(T1 + 1 hours);
        feed.set(110e8, block.timestamp);
        claims.settle(poolKey, 0);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(BellguardClaims.NotPositionOwner.selector);
        claims.registerClaim(poolKey, 0, _position(lower, upper, bytes32(0)));
    }

    function test_settlementTiming() public {
        vm.warp(T0 + 1 hours);
        _buyStock(10_000e6);

        vm.warp(T1 + 30 minutes);
        vm.expectRevert(BellguardClaims.TooEarly.selector);
        claims.settle(poolKey, 0);

        // Feed not updated since before reopen -> stale
        vm.warp(T1 + 1 hours);
        feed.set(110e8, T1 - 1);
        vm.expectRevert(BellguardClaims.StalePrice.selector);
        claims.settle(poolKey, 0);

        // After the public slot only the owner can settle
        vm.warp(T1 + 2 hours + 1);
        feed.set(110e8, block.timestamp);
        vm.prank(makeAddr("anyone"));
        vm.expectRevert(BellguardClaims.SettleSlotClosed.selector);
        claims.settle(poolKey, 0);
        claims.settle(poolKey, 0);

        vm.expectRevert(BellguardClaims.AlreadySettled.selector);
        claims.settle(poolKey, 0);
    }

    function test_claimBeforeSettlementReverts() public {
        vm.warp(T0 + 1 hours);
        _buyStock(10_000e6);
        vm.prank(address(modifyLiquidityRouter));
        vm.expectRevert(BellguardClaims.NotSettled.selector);
        claims.registerClaim(poolKey, 0, _position(lower, upper, bytes32(0)));
    }

    function test_proRataWhenClaimsExceedBudget() public {
        // Tiny budget: 0.01% of the vault
        claims.setTerms(BellguardClaims.Terms({deductibleBps: 0, capBps: 500, maxWindowBps: 1}));
        vm.warp(T0 + 1 hours);
        _buyStock(100_000e6);
        vm.warp(T1 + 1 hours);
        feed.set(110e8, block.timestamp);
        claims.settle(poolKey, 0);
        (, uint256 budget,) = claims.budgets(0);
        assertEq(budget, vault.totalAssets() * 1 / 10_000);

        vm.prank(address(modifyLiquidityRouter));
        (bytes32 claimId, uint256 amount) = claims.registerClaim(poolKey, 0, _position(lower, upper, bytes32(0)));
        assertGt(amount, budget);
        vm.warp(claims.claimDeadline(0));
        assertEq(claims.payClaim(claimId), budget);
    }

    function test_onlyClaimsCanPayFromVault() public {
        vm.expectRevert(CoverVault.NotClaims.selector);
        vault.payClaim(address(this), 1);
    }

    function test_rateCeiling() public {
        vm.expectRevert(BellguardHook.RateTooHigh.selector);
        hook.setRates(301, 0);
    }

    function test_onlyPoolManagerCallsHook() public {
        vm.expectRevert(BellguardHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), poolKey, IPoolManager.SwapParams(true, -1, 0), "");
    }
}

/// Same suite with the stock token as currency0.
contract BellguardTestStockFirst is BellguardTest {
    function _stockFirst() internal pure override returns (bool) {
        return true;
    }
}
