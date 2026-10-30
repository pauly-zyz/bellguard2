// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {GapCoverMath} from "../src/GapCoverMath.sol";

contract GapCoverMathTest is Test {
    // Mirrors research/tests/test_gapscan.py::ReportTest.test_payout_deductible_and_cap
    function test_payout_examples() public pure {
        uint256 notional = 1_000_000e6;
        assertEq(GapCoverMath.payout(0, notional, 25, 100), 0);
        assertEq(GapCoverMath.payout(2_000e6, notional, 25, 100), 0); // under deductible
        assertEq(GapCoverMath.payout(5_000e6, notional, 25, 100), 2_500e6);
        assertEq(GapCoverMath.payout(50_000e6, notional, 25, 100), 10_000e6); // capped
    }

    function testFuzz_payoutBounded(uint128 loss, uint128 notional, uint16 dedBps, uint16 capBps) public pure {
        dedBps = uint16(bound(dedBps, 0, 10_000));
        capBps = uint16(bound(capBps, 0, 10_000));
        uint256 p = GapCoverMath.payout(loss, notional, dedBps, capBps);
        assertLe(p, loss); // never pays more than the loss
        assertLe(p, uint256(notional) * capBps / 10_000); // never above the cap
    }

    function testFuzz_payoutMonotonicInLoss(uint128 a, uint128 b, uint128 notional) public pure {
        (uint256 lo, uint256 hi) = a < b ? (uint256(a), uint256(b)) : (uint256(b), uint256(a));
        assertLe(GapCoverMath.payout(lo, notional, 25, 500), GapCoverMath.payout(hi, notional, 25, 500));
    }

    function test_surcharge() public pure {
        assertEq(GapCoverMath.surchargeBps(false, 10_000, 30, 0, 100), 0);
        assertEq(GapCoverMath.surchargeBps(true, 10_000, 30, 0, 100), 30);
        assertEq(GapCoverMath.surchargeBps(true, 25_000, 30, 0, 100), 75); // earnings weekend
        assertEq(GapCoverMath.surchargeBps(true, 100_000, 30, 0, 100), 100); // ceiling
    }

    function testFuzz_surchargeNeverAboveMax(bool closed, uint32 mult, uint16 closedBps, uint16 openBps, uint16 maxBps)
        public
        pure
    {
        assertLe(GapCoverMath.surchargeBps(closed, mult, closedBps, openBps, maxBps), maxBps);
    }

    function test_proRata() public pure {
        // Vault 1M, may pay 20% (200k) per window.
        assertEq(GapCoverMath.proRata(50_000, 100_000, 1_000_000, 2_000), 50_000); // fully paid
        assertEq(GapCoverMath.proRata(100_000, 400_000, 1_000_000, 2_000), 50_000); // scaled by 1/2
        assertEq(GapCoverMath.proRata(1, 0, 1_000_000, 2_000), 0);
    }

    function testFuzz_proRataNeverExceedsBudget(uint96 claim, uint96 others, uint96 vault, uint16 maxBps) public pure {
        maxBps = uint16(bound(maxBps, 0, 10_000));
        uint256 total = uint256(claim) + others;
        uint256 paid = GapCoverMath.proRata(claim, total, vault, maxBps);
        assertLe(paid, claim);
        if (total > 0) {
            // Summing every claimant's share can't exceed the window budget.
            uint256 othersPaid = GapCoverMath.proRata(others, total, vault, maxBps);
            assertLe(paid + othersPaid, max(uint256(vault) * maxBps / 10_000, total));
            if (total > uint256(vault) * maxBps / 10_000) {
                assertLe(paid + othersPaid, uint256(vault) * maxBps / 10_000);
            }
        }
    }

    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}
