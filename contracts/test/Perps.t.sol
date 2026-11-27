// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MarketCalendar} from "../src/MarketCalendar.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {PerpVault} from "../src/perps/PerpVault.sol";
import {PerpEngine} from "../src/perps/PerpEngine.sol";
import {PushPriceFeed} from "../src/perps/PushPriceFeed.sol";
import {TestUSD} from "../src/perps/TestUSD.sol";

contract PerpsTest is Test {
    TestUSD usd;
    MarketCalendar cal;
    PerpVault vault;
    PerpEngine engine;
    PushPriceFeed feed;

    address owner = address(0xA11CE);
    address lp = address(0x1111);
    address alice = address(0xA);
    address bob = address(0xB);
    address keeper = address(0xC);

    // Mon 2027-01-04 00:00 UTC; closure Sat 01:00 -> Mon 01:00
    uint64 constant T0 = 1_799_020_800;
    uint64 constant CLOSE = T0 + 5 days + 1 hours;
    uint64 constant REOPEN = CLOSE + 2 days;
    uint256 constant P100 = 100e8;

    function defaultParams() internal pure returns (PerpEngine.Params memory) {
        return PerpEngine.Params({
            openFeeBps: 8, closeFeeBps: 8, spreadBps: 5, maintenanceBps: 100, liquidationFeeBps: 20,
            deleverageFeeBps: 5, maxProfitBps: 90_000, borrowBpsPerDay: 3, closedBorrowMultiplier: 3,
            maxLeverage: 20, weekendMaxLeverage: 5, preCloseWindow: 2 hours, maxUtilizationBps: 8_000,
            minCollateral: 10e6
        });
    }

    function setUp() public {
        vm.warp(T0);
        usd = new TestUSD(address(this));
        cal = new MarketCalendar(owner, 0);
        MarketCalendar.Window[] memory w = new MarketCalendar.Window[](2);
        w[0] = MarketCalendar.Window(CLOSE, REOPEN);
        w[1] = MarketCalendar.Window(CLOSE + 7 days, REOPEN + 7 days);
        vm.prank(owner);
        cal.addClosures(w);

        vault = new PerpVault(IERC20(address(usd)), "Bellguard Perp LP", "bpLP", owner);
        engine = new PerpEngine(IERC20(address(usd)), vault, cal, defaultParams(), owner);
        vm.prank(owner);
        vault.setEngine(address(engine));

        feed = new PushPriceFeed(8, "TSLA / USD", address(this), 10_000, owner);
        feed.update(int256(P100), block.timestamp);
        vm.prank(owner);
        engine.addMarket("TSLA", IAggregatorV3(address(feed)), 1_000_000e6, 1 hours);

        _fund(lp, 1_000_000e6);
        vm.startPrank(lp);
        usd.approve(address(vault), type(uint256).max);
        vault.deposit(1_000_000e6, lp);
        vm.stopPrank();
        _fund(alice, 100_000e6);
        _fund(bob, 100_000e6);
    }

    function _fund(address who, uint256 amount) internal {
        deal(address(usd), who, amount);
        vm.prank(who);
        usd.approve(address(engine), type(uint256).max);
    }

    function _price(uint256 p) internal {
        feed.update(int256(p), block.timestamp);
    }

    function _open(address who, bool isLong, uint256 collateral, uint256 size) internal returns (uint256 id) {
        vm.prank(who);
        id = engine.openPosition(0, isLong, collateral, size, 0);
    }

    // ------------------------------------------------------------------ basics

    function test_longProfitPaidByVault() public {
        uint256 id = _open(alice, true, 1_000e6 + 8e6, 10_000e6); // 10x after fee
        uint256 entry = engine.position(id).entryPrice;
        assertEq(entry, P100 * 10_005 / 10_000, "entry pays spread");

        vm.warp(T0 + 1 hours);
        _price(110e8);
        uint256 vaultBefore = usd.balanceOf(address(vault));
        uint256 before = usd.balanceOf(alice);
        vm.prank(alice);
        engine.closePosition(id, 0);
        uint256 got = usd.balanceOf(alice) - before;
        // ~ +9.9% on 10k size, minus fees, plus 1k collateral back
        assertGt(got, 1_000e6 + 950e6);
        assertLt(got, 1_000e6 + 1_000e6);
        assertLt(usd.balanceOf(address(vault)), vaultBefore, "vault paid the profit");
        assertEq(engine.totalReserved(), 0);
    }

    function test_shortProfitAndLongLoss() public {
        uint256 s = _open(alice, false, 2_000e6, 10_000e6);
        uint256 l = _open(bob, true, 2_000e6, 10_000e6);
        vm.warp(T0 + 2 hours);
        _price(95e8);
        uint256 a0 = usd.balanceOf(alice);
        uint256 b0 = usd.balanceOf(bob);
        vm.prank(alice);
        engine.closePosition(s, 0);
        vm.prank(bob);
        engine.closePosition(l, 0);
        assertGt(usd.balanceOf(alice) - a0, 2_000e6 + 400e6, "short won ~5%");
        assertLt(usd.balanceOf(bob) - b0, 2_000e6 - 400e6, "long lost ~5%");
    }

    function test_feesGoToVault() public {
        uint256 v0 = usd.balanceOf(address(vault));
        _open(alice, true, 1_008e6, 10_000e6);
        assertEq(usd.balanceOf(address(vault)) - v0, 8e6, "0.08% open fee");
    }

    function test_leverageAndCollateralLimits() public {
        vm.prank(alice);
        vm.expectRevert(PerpEngine.LeverageTooHigh.selector);
        engine.openPosition(0, true, 1_000e6, 21_000e6, 0);
        vm.prank(alice);
        vm.expectRevert(PerpEngine.CollateralTooSmall.selector);
        engine.openPosition(0, true, 5e6, 10e6, 0);
    }

    function test_acceptablePriceProtectsTrader() public {
        vm.prank(alice);
        vm.expectRevert(PerpEngine.PriceNotAcceptable.selector);
        engine.openPosition(0, true, 1_000e6, 5_000e6, P100); // fill is P100 + spread
    }

    function test_profitCapped() public {
        uint256 id = _open(alice, true, 1_016e6, 20_000e6);
        vm.warp(T0 + 1 hours);
        _price(200e8); // +100% on 20x would be 20x collateral
        (, int256 pnl,,,) = engine.positionValue(id);
        assertEq(uint256(pnl), engine.position(id).maxProfit, "capped at 9x collateral");
    }

    // ------------------------------------------------------------------ liquidation

    function test_liquidation() public {
        uint256 id = _open(alice, true, 1_016e6, 20_000e6); // ~20x
        vm.warp(T0 + 1 hours);
        _price(94e8); // -6% on 20x is more than the whole margin
        (,,,, bool liq) = engine.positionValue(id);
        assertTrue(liq);
        uint256 v0 = usd.balanceOf(address(vault));
        vm.prank(keeper);
        engine.liquidate(id);
        assertEq(usd.balanceOf(keeper), 0, "equity was negative, no reward");
        assertGt(usd.balanceOf(address(vault)), v0);
        assertEq(engine.position(id).size, 0);
    }

    function test_cannotLiquidateHealthy() public {
        uint256 id = _open(alice, true, 1_000e6, 5_000e6);
        vm.prank(keeper);
        vm.expectRevert(PerpEngine.NotLiquidatable.selector);
        engine.liquidate(id);
    }

    function test_liquidatorRewardWhenEquityLeft() public {
        uint256 id = _open(alice, true, 1_016e6, 20_000e6);
        vm.warp(T0 + 1 hours);
        _price(95_80e6); // -4.2% incl. spread leaves a little equity below maintenance
        (int256 equity,,,, bool liq) = engine.positionValue(id);
        if (liq && equity > 0) {
            vm.prank(keeper);
            engine.liquidate(id);
            assertGt(usd.balanceOf(keeper), 0);
        }
    }

    // ------------------------------------------------------------------ bell mode

    function test_tradingPausedWhileClosed() public {
        uint256 id = _open(alice, true, 1_000e6, 5_000e6);
        vm.warp(CLOSE + 1 hours);
        vm.prank(alice);
        vm.expectRevert(PerpEngine.MarketClosed.selector);
        engine.closePosition(id, 0);
        vm.prank(bob);
        vm.expectRevert(PerpEngine.MarketClosed.selector);
        engine.openPosition(0, false, 1_000e6, 5_000e6, 0);
        vm.prank(keeper);
        vm.expectRevert(PerpEngine.MarketClosed.selector);
        engine.liquidate(id);
        // topping up is allowed
        vm.prank(alice);
        engine.addCollateral(id, 100e6);
    }

    function test_needsFreshPriceAfterReopen() public {
        uint256 id = _open(alice, true, 1_000e6, 5_000e6);
        vm.warp(CLOSE - 10 minutes);
        _price(100e8); // last price before the weekend
        vm.warp(REOPEN + 5 minutes);
        vm.prank(alice);
        vm.expectRevert(PerpEngine.StalePrice.selector);
        engine.closePosition(id, 0);
        _price(90e8); // first price after reopen
        vm.prank(alice);
        engine.closePosition(id, 0);
    }

    function test_weekendGapLiquidatesAtReopenPrice() public {
        uint256 id = _open(alice, true, 1_000e6, 10_000e6);
        vm.warp(REOPEN + 1 minutes);
        _price(85e8); // -15% gap
        uint256 v0 = usd.balanceOf(address(vault));
        vm.prank(keeper);
        engine.liquidate(id);
        assertEq(usd.balanceOf(address(vault)) - v0, 1_000e6 - 8e6, "vault keeps the collateral (net of fee already paid)");
    }

    function test_preCloseLeverageCap() public {
        vm.warp(CLOSE - 1 hours);
        _price(P100);
        assertTrue(engine.inPreCloseWindow());
        vm.prank(alice);
        vm.expectRevert(PerpEngine.LeverageTooHigh.selector);
        engine.openPosition(0, true, 1_000e6, 10_000e6, 0); // 10x > 5x weekend cap
        _open(alice, true, 1_000e6, 4_000e6); // 4x is fine
    }

    function test_deleverageBeforeClose() public {
        uint256 id = _open(alice, true, 1_000e6, 15_000e6); // ~15x
        vm.prank(keeper);
        vm.expectRevert(PerpEngine.NotInPreCloseWindow.selector);
        engine.deleverage(id);

        vm.warp(CLOSE - 30 minutes);
        _price(101e8);
        (int256 eq0,,,,) = engine.positionValue(id);
        vm.prank(keeper);
        engine.deleverage(id);
        PerpEngine.Position memory p = engine.position(id);
        assertLe(p.size, uint256(eq0) * 5, "at most 5x the equity it had");
        (int256 eq1,,,,) = engine.positionValue(id);
        assertLe(p.size, uint256(eq1) * 5, "within the cap afterwards");
        assertGe(p.size, uint256(eq1) * 5 - 5, "and not trimmed more than needed");
        assertGt(usd.balanceOf(keeper), 0, "keeper paid");
        vm.prank(keeper);
        vm.expectRevert(PerpEngine.WithinWeekendLeverage.selector);
        engine.deleverage(id);
        // value preserved: closing right away returns about the equity before trimming
        uint256 a0 = usd.balanceOf(alice);
        vm.prank(alice);
        engine.closePosition(id, 0);
        uint256 got = usd.balanceOf(alice) - a0;
        assertApproxEqRel(got, uint256(eq0), 0.01e18);
    }

    function test_weekendBorrowIsMultiplied() public {
        uint256 id = _open(alice, true, 10_000e6, 10_000e6);
        vm.warp(CLOSE - 1);
        _price(P100);
        (,, uint256 fridayFee,,) = engine.positionValue(id);
        vm.warp(REOPEN + 1);
        _price(P100);
        (,, uint256 mondayFee,,) = engine.positionValue(id);
        // 2 closed days at 3x = 6 days' worth on top of the ~5 open days
        uint256 perDay = 10_000e6 * 3 / 10_000;
        assertApproxEqAbs(mondayFee - fridayFee, perDay * 6, perDay / 50);
    }

    // ------------------------------------------------------------------ vault safety

    function test_vaultReservesProfitCaps() public {
        _open(alice, true, 10_000e6, 100_000e6);
        uint256 reserved = engine.totalReserved();
        assertEq(reserved, (10_000e6 - 80e6) * 9);
        assertEq(vault.freeAssets(), vault.totalAssets() - reserved);
        uint256 all = vault.totalAssets();
        vm.prank(lp);
        vm.expectRevert();
        vault.withdraw(all, lp, lp);
        uint256 maxW = vault.maxWithdraw(lp);
        vm.prank(lp);
        vault.withdraw(maxW, lp, lp);
    }

    function test_utilizationCap() public {
        vm.prank(owner);
        engine.updateMarket(0, true, 100_000_000e6, 1 hours);
        _fund(alice, 200_000e6);
        // 8,000 collateral * 9 = 72k reserve each; cap is 80% of ~1M
        for (uint256 i; i < 11; ++i) _open(alice, true, 8_000e6, 8_000e6);
        vm.prank(alice);
        vm.expectRevert(PerpEngine.VaultCapacity.selector);
        engine.openPosition(0, true, 8_000e6, 8_000e6, 0);
    }

    function test_openInterestCap() public {
        vm.prank(owner);
        engine.updateMarket(0, true, 20_000e6, 1 hours);
        _open(alice, true, 1_000e6, 15_000e6);
        vm.prank(bob);
        vm.expectRevert(PerpEngine.OpenInterestCap.selector);
        engine.openPosition(0, true, 1_000e6, 10_000e6, 0);
        _open(bob, false, 1_000e6, 10_000e6); // shorts have their own cap
    }

    function test_staleOracleRejected() public {
        vm.warp(T0 + 2 hours);
        vm.prank(alice);
        vm.expectRevert(PerpEngine.StalePrice.selector);
        engine.openPosition(0, true, 1_000e6, 5_000e6, 0);
    }

    function test_onlyOwnerCloses() public {
        uint256 id = _open(alice, true, 1_000e6, 5_000e6);
        vm.prank(bob);
        vm.expectRevert(PerpEngine.NotOwner.selector);
        engine.closePosition(id, 0);
    }

    function test_paramBounds() public {
        PerpEngine.Params memory p = defaultParams();
        p.maxLeverage = 200;
        vm.prank(owner);
        vm.expectRevert(PerpEngine.InvalidParams.selector);
        engine.setParams(p);
        p = defaultParams();
        p.maintenanceBps = 600; // 6% * 20x would be liquidatable at open
        vm.prank(owner);
        vm.expectRevert(PerpEngine.InvalidParams.selector);
        engine.setParams(p);
    }

    /// Launch settings (script/DeployPerps.s.sol): 5x max, 3x in the pre-close window.
    function test_launchLeverageCaps() public {
        PerpEngine.Params memory p = defaultParams();
        p.maxLeverage = 5;
        p.weekendMaxLeverage = 3;
        vm.prank(owner);
        engine.setParams(p);

        vm.prank(alice);
        vm.expectRevert(PerpEngine.LeverageTooHigh.selector);
        engine.openPosition(0, true, 1_000e6, 6_000e6, 0); // 6x
        uint256 id = _open(alice, true, 1_004e6, 5_000e6); // 5x after the fee

        vm.warp(CLOSE - 1 hours);
        _price(P100);
        vm.prank(bob);
        vm.expectRevert(PerpEngine.LeverageTooHigh.selector);
        engine.openPosition(0, true, 1_004e6, 4_000e6, 0); // 4x > 3x before the close
        _open(bob, true, 1_003e6, 3_000e6); // 3x is fine

        vm.prank(keeper);
        engine.deleverage(id); // the 5x position is trimmed to 3x
        (int256 eq,,,,) = engine.positionValue(id);
        assertLe(engine.position(id).size, uint256(eq) * 3);
    }

    function test_pauseStopsTrading() public {
        uint256 id = _open(alice, true, 1_000e6, 3_000e6);
        vm.prank(alice);
        vm.expectRevert();
        engine.setPaused(true); // only owner
        vm.prank(owner);
        engine.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(PerpEngine.Paused.selector);
        engine.closePosition(id, 0);
        vm.prank(bob);
        vm.expectRevert(PerpEngine.Paused.selector);
        engine.openPosition(0, true, 1_000e6, 2_000e6, 0);
        vm.prank(alice);
        engine.addCollateral(id, 10e6); // still allowed
        vm.prank(owner);
        engine.setPaused(false);
        vm.prank(alice);
        engine.closePosition(id, 0);
    }

    function test_feedDeviationGuard() public {
        PushPriceFeed f = new PushPriceFeed(8, "X / USD", address(this), 2_500, owner);
        f.update(100e8, block.timestamp);
        vm.warp(block.timestamp + 1);
        f.update(124e8, block.timestamp); // +24% ok
        vm.warp(block.timestamp + 1);
        vm.expectRevert(PushPriceFeed.MoveTooLarge.selector);
        f.update(50e8, block.timestamp); // -60% blocked for the updater
        vm.prank(owner);
        f.forceUpdate(50e8, block.timestamp); // owner can publish a real large gap
        (, int256 a,,,) = f.latestRoundData();
        assertEq(a, 50e8);
    }

    /// Engine always holds exactly the collateral of open positions, whatever happens.
    function testFuzz_solvency(uint96 col, uint16 levX, bool isLong, uint16 movePct, bool up) public {
        uint256 c = bound(uint256(col), 20e6, 50_000e6);
        uint256 lev = bound(uint256(levX), 1, 20);
        uint256 size = (c - c / 50) * lev; // leave room for the fee
        size = size > c * 19 ? c * 19 : size;
        _fund(alice, c);
        uint256 id = _open(alice, isLong, c, size);
        uint256 m = bound(uint256(movePct), 0, 60);
        vm.warp(T0 + 30 minutes);
        _price(up ? P100 * (100 + m) / 100 : P100 * (100 - m) / 100);
        (,,,, bool liq) = engine.positionValue(id);
        if (liq) {
            vm.prank(keeper);
            engine.liquidate(id);
        } else {
            vm.prank(alice);
            engine.closePosition(id, 0);
        }
        assertEq(usd.balanceOf(address(engine)), 0, "no collateral left behind");
        assertEq(engine.totalReserved(), 0);
    }
}
