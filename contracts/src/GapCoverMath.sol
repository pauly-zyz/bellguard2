// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

/// @title GapCoverMath
/// @notice Pure pricing and payout rules for Bellguard. Kept separate so the
///         same rules can be tested exhaustively and mirrored by the research
///         tool (research/gapscan/report.py: payout_usd).
library GapCoverMath {
    uint256 internal constant BPS = 10_000;

    /// @notice Surcharge (in bps of swap input) charged on a swap.
    /// @param closed            whether the underlying market is closed
    /// @param riskMultiplierBps event multiplier from MarketCalendar (10_000 = none)
    /// @param closedBps         base surcharge while closed
    /// @param openBps           surcharge while open (usually 0)
    /// @param maxBps            hard ceiling, so the hook can never charge more
    function surchargeBps(
        bool closed,
        uint256 riskMultiplierBps,
        uint256 closedBps,
        uint256 openBps,
        uint256 maxBps
    ) internal pure returns (uint256 bps) {
        bps = closed ? closedBps * riskMultiplierBps / BPS : openBps;
        if (bps > maxBps) bps = maxBps;
    }

    /// @notice Payout for one LP position over one closed window.
    /// @param loss          measured LP loss over the window (0 if the LP gained)
    /// @param notional      position value at the close
    /// @param deductibleBps LP keeps the first `deductibleBps` of notional
    /// @param capBps        payout never exceeds `capBps` of notional
    function payout(uint256 loss, uint256 notional, uint256 deductibleBps, uint256 capBps)
        internal
        pure
        returns (uint256)
    {
        uint256 deductible = notional * deductibleBps / BPS;
        if (loss <= deductible) return 0;
        uint256 covered = loss - deductible;
        uint256 cap = notional * capBps / BPS;
        return covered < cap ? covered : cap;
    }

    /// @notice Scale claims down pro rata when they exceed what the vault may
    ///         pay for one window (`maxWindowBps` of vault assets).
    /// @return paid amount actually paid on a claim of `claim`
    function proRata(uint256 claim, uint256 totalClaims, uint256 vaultAssets, uint256 maxWindowBps)
        internal
        pure
        returns (uint256 paid)
    {
        if (totalClaims == 0) return 0;
        uint256 budget = vaultAssets * maxWindowBps / BPS;
        if (totalClaims <= budget) return claim;
        return claim * budget / totalClaims;
    }
}
