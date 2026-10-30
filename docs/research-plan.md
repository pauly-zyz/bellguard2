# Research plan (Phase 0)

Goal: decide whether gap risk is big enough to sell cover for, and at what
price, before writing the hook and vault.

## Done

- [x] Stock-token discovery from Robinhood's StockFactory (212 tokens)
- [x] Pool discovery: 202 stock/USDG and stock/WETH Uniswap v3 pools with liquidity
- [x] Closed-window calendar: weekends (Robinhood's CET window), US holidays, DST
- [x] Per-window LP markout from Swap logs (no archive node needed)
- [x] First premium estimate with deductible and cap (`gapscan report`)

## Next

1. **Chainlink reference prices.** Get feed addresses from Chainlink's
   reference-data-directory (`feeds-robinhood-mainnet.json`). Read
   `AnswerUpdated` logs from each feed's aggregator. Use the first update
   after reopen as `p_reopen`. Compare with the pool-based price.
2. **Longer history and more pools.** Run on a paid RPC across all 202
   pools. Re-run weekly and track how the distribution changes.
3. **Position-level loss.** Rebuild v3 positions from Mint/Burn events.
   Measure loss per in-range position, not per pool. This is what claims
   will be paid on.
4. **Earnings effect.** Tag windows that contain an earnings release and
   compare gaps. This justifies the calendar's risk multiplier.
5. **Corporate actions.** Exclude or adjust windows where the ERC-8056
   multiplier changed (Robinhood corporate-actions feed).
6. **Sensitivity.** Break-even surcharge across deductible (0 to 100 bps),
   cap (1 to 10%) and settle time (15 to 120 minutes).

## Decision gate

Move to Phase 1 (v4 hook + vault on testnet) if:

- payouts are frequent enough that LPs value the cover, and
- the break-even surcharge stays below what closed-window traders already
  pay elsewhere (competing hooks charge about 1% while the market is
  closed).
