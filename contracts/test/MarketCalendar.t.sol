// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";

contract MarketCalendarTest is Test {
    MarketCalendar cal;
    address owner = makeAddr("owner");
    address asset = makeAddr("TSLA");

    uint64 constant T0 = 1_791_590_400; // 2026-10-10 00:00 UTC (Sat 02:00 Berlin)
    uint256 constant NOTICE = 1 hours;

    function setUp() public {
        vm.warp(T0 - 7 days);
        cal = new MarketCalendar(owner, NOTICE);
    }

    function _weekends(uint256 n) internal pure returns (MarketCalendar.Window[] memory ws) {
        ws = new MarketCalendar.Window[](n);
        for (uint256 i; i < n; ++i) {
            uint64 s = T0 + uint64(i * 7 days);
            ws[i] = MarketCalendar.Window(s, s + 48 hours);
        }
    }

    function test_isClosed() public {
        vm.prank(owner);
        cal.addClosures(_weekends(3));
        assertEq(cal.closureCount(), 3);

        assertFalse(cal.isClosed(T0 - 1));
        assertTrue(cal.isClosed(T0));
        assertTrue(cal.isClosed(T0 + 47 hours));
        assertFalse(cal.isClosed(T0 + 48 hours)); // reopen is exclusive
        assertTrue(cal.isClosed(T0 + 7 days + 1));
        assertFalse(cal.isClosed(T0 + 30 days));

        (bool closed, uint256 idx, MarketCalendar.Window memory w) = cal.closureAt(T0 + 14 days + 5);
        assertTrue(closed);
        assertEq(idx, 2);
        assertEq(w.start, T0 + 14 days);
    }

    function test_isClosedNow() public {
        vm.prank(owner);
        cal.addClosures(_weekends(1));
        vm.warp(T0 + 1 hours);
        assertTrue(cal.isClosedNow());
        vm.warp(T0 + 49 hours);
        assertFalse(cal.isClosedNow());
    }

    function test_onlyOwner() public {
        MarketCalendar.Window[] memory ws = _weekends(1);
        vm.expectRevert(MarketCalendar.NotOwner.selector);
        cal.addClosures(ws);
    }

    function test_rejectsTooLate() public {
        vm.warp(T0 - 30 minutes); // less than 1h notice
        MarketCalendar.Window[] memory ws = _weekends(1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MarketCalendar.TooLate.selector, T0, T0 - 30 minutes + NOTICE));
        cal.addClosures(ws);
    }

    function test_rejectsOverlapAndOutOfOrder() public {
        vm.startPrank(owner);
        cal.addClosures(_weekends(1));
        MarketCalendar.Window[] memory ws = new MarketCalendar.Window[](1);
        ws[0] = MarketCalendar.Window(T0 + 24 hours, T0 + 72 hours);
        vm.expectRevert(abi.encodeWithSelector(MarketCalendar.Overlap.selector, T0 + 24 hours, T0 + 48 hours));
        cal.addClosures(ws);
        vm.stopPrank();
    }

    function test_rejectsBadWindows() public {
        MarketCalendar.Window[] memory ws = new MarketCalendar.Window[](1);
        vm.startPrank(owner);
        ws[0] = MarketCalendar.Window(T0, T0);
        vm.expectRevert(abi.encodeWithSelector(MarketCalendar.BadWindow.selector, T0, T0));
        cal.addClosures(ws);
        ws[0] = MarketCalendar.Window(T0, T0 + 8 days);
        vm.expectRevert(abi.encodeWithSelector(MarketCalendar.BadWindow.selector, T0, T0 + 8 days));
        cal.addClosures(ws);
        vm.stopPrank();
    }

    function test_cancelFutureOnly() public {
        vm.prank(owner);
        cal.addClosures(_weekends(3));

        vm.prank(owner);
        cal.cancelClosure(1);
        assertEq(cal.closureCount(), 2);
        assertEq(cal.closure(1).start, T0 + 14 days); // order kept
        assertFalse(cal.isClosed(T0 + 7 days + 1));

        vm.warp(T0 + 1); // first window has started: immutable
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MarketCalendar.TooLate.selector, T0, T0 + 1 + NOTICE));
        cal.cancelClosure(0);
    }

    function test_events() public {
        MarketCalendar.EventWindow memory e =
            MarketCalendar.EventWindow(T0 + 3 days, T0 + 4 days, 25_000);
        vm.prank(owner);
        cal.addEvent(asset, e);
        assertEq(cal.riskMultiplierBps(asset, T0), 10_000);
        assertEq(cal.riskMultiplierBps(asset, T0 + 3 days), 25_000);
        assertEq(cal.riskMultiplierBps(asset, T0 + 4 days), 10_000);
        assertEq(cal.riskMultiplierBps(makeAddr("other"), T0 + 3 days), 10_000);
    }

    function test_eventValidation() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(MarketCalendar.BadMultiplier.selector, 9_999));
        cal.addEvent(asset, MarketCalendar.EventWindow(T0, T0 + 1 days, 9_999));
        vm.expectRevert(abi.encodeWithSelector(MarketCalendar.BadWindow.selector, T0, T0 + 4 days));
        cal.addEvent(asset, MarketCalendar.EventWindow(T0, T0 + 4 days, 20_000));
        cal.addEvent(asset, MarketCalendar.EventWindow(T0, T0 + 1 days, 20_000));
        vm.expectRevert(abi.encodeWithSelector(MarketCalendar.Overlap.selector, T0 + 12 hours, T0 + 1 days));
        cal.addEvent(asset, MarketCalendar.EventWindow(T0 + 12 hours, T0 + 2 days, 20_000));
        vm.stopPrank();
    }

    function test_cancelEvent() public {
        vm.startPrank(owner);
        cal.addEvent(asset, MarketCalendar.EventWindow(T0, T0 + 1 days, 20_000));
        cal.addEvent(asset, MarketCalendar.EventWindow(T0 + 2 days, T0 + 3 days, 30_000));
        cal.cancelEvent(asset, 0);
        vm.stopPrank();
        assertEq(cal.eventCount(asset), 1);
        assertEq(cal.riskMultiplierBps(asset, T0 + 1 hours), 10_000);
        assertEq(cal.riskMultiplierBps(asset, T0 + 2 days), 30_000);
    }

    function test_twoStepOwnership() public {
        address next = makeAddr("next");
        vm.prank(owner);
        cal.transferOwnership(next);
        assertEq(cal.owner(), owner);
        vm.expectRevert(MarketCalendar.NotPendingOwner.selector);
        cal.acceptOwnership();
        vm.prank(next);
        cal.acceptOwnership();
        assertEq(cal.owner(), next);
    }

    /// Binary search agrees with a linear scan for any timestamp.
    function testFuzz_isClosedMatchesLinearScan(uint32 offset) public {
        vm.prank(owner);
        cal.addClosures(_weekends(8));
        uint256 ts = uint256(T0) - 1 days + (uint256(offset) % 70 days);
        bool expected;
        for (uint256 i; i < 8; ++i) {
            MarketCalendar.Window memory w = cal.closure(i);
            if (ts >= w.start && ts < w.end) expected = true;
        }
        assertEq(cal.isClosed(ts), expected);
    }
}
