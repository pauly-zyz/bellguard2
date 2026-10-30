# Findings: closed-market gaps on Robinhood Chain (Oct 2026)

Data: `research/data/2026-10-30/` (results CSV, pool list, generated report).
Method: `research/gapscan`, pool-referenced (reopen price = pool price 60 minutes after reopen).

## Sample

- 5 large Uniswap v3 pools: NVDA/USDG 0.05%, SPCX/USDG 0.05%, TSLA/USDG 0.3%, SPY/USDG 0.05%, COIN/WETH 0.3%
- 14 closed windows (weekends and Labor Day), 2026-07-25 to 2026-10-24
- 65 usable pool-windows, $366M of swap volume while the market was closed

## Results

| | |
|---|---|
| Pool-windows where LPs lost money | **4 of 65** |
| Net LP result over all windows, fees included | **+$181,614** |
| Worst window | NVDA/USDG, weekend of 2026-09-12, **−$9,660** (gap −1.69%) |
| Median / largest reopen gap | 0.58% / 1.69% |
| Gaps above 3% | none |
| Payouts under default terms (25 bps deductible) | **none** |
| Worst window for a ±5% range LP | −7.2 bps of capital |

## What it means for Bellguard

1. **Weekend trading has paid LPs, not hurt them, so far.** Fees on $366M of
   closed-market volume ($230k) outweighed losses to informed flow. The gaps
   were small, with no earnings shock or macro event in the sample.
2. **The default premium (0.30%) is far above break-even** for this sample. The
   break-even surcharge was 0 bps because nothing would have paid out. Charging
   0.30% on weekend swaps also makes Bellguard pools more expensive than
   neighbouring v3 pools, so traders may route around them.
3. **The product is tail cover.** Its value is in the windows this sample doesn't
   contain yet: an earnings miss, a halt or a market-wide shock with a 5–15% gap.
   Recommended changes before launch:
   - lower the default surcharge (for example 5–10 bps) and rely on the calendar's
     event multiplier around earnings;
   - raise the deductible to about 1% of position value so only large gaps pay,
     which keeps the vault solvent and the premium low;
   - market it to LPs who run concentrated positions, where a 5% gap costs a
     large share of capital.
4. **Liquidity is on v3.** Bellguard pools are new v4 pools and have to attract
   LPs. The cover, plus low weekend fees, is the reason to move.

## Caveats

- Reference prices come from the pool, not Chainlink. If pools had not fully
  converged within 60 minutes of reopen, losses are understated. The Chainlink
  mode is built (`scan` loads feed history from AnswerUpdated logs) but needs a
  paid RPC for full history. The public endpoint rate-limits heavily.
- Pool-level markout, not per position. Concentrated positions near the price
  see larger percentage losses (see the range-width table in the report).
- Three months is a short sample with no large shocks.
