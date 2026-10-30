# gapscan: Phase 0 research tool

Measures how much liquidity providers in Robinhood stock-token pools won or
lost while the stock market was closed. The results are used to price
Bellguard's cover.

Pure Python 3.11+, standard library only. No API keys: it reads the public
Robinhood Chain RPC.

## Quick start

```bash
cd research
python -m gapscan discover                     # stock tokens + pools -> pools.json
python -m gapscan windows --since 2026-07-01   # list closed-market windows
python -m gapscan scan --only TSLA,NVDA,SPY    # measure each window -> results.csv
python -m gapscan report                       # summary + premium estimate
python -m unittest discover -s tests           # offline tests
```

Useful options:

- `scan --top 10`: limit to the 10 pools with the most active liquidity now
- `scan --settle 30`: take the reopen price 30 minutes after reopen (default 60)
- `report --deductible-bps 25 --cap-bps 500 --loading 1.5`: cover terms to test
- `--rpc URL`: use a dedicated RPC (Alchemy, QuickNode, ...). The public one is rate-limited.
- `--cache DIR`: on-disk cache (default `.cache`). Re-runs are much faster.

## What it measures

For every closed window (weekends and US market holidays, see
`gapscan/calendar.py`) and every pool:

| Field | Meaning |
|---|---|
| `p_close` | Pool price at the close: the last swap before the window |
| `p_last_closed` | Last pool price inside the window |
| `p_reopen` | Pool price `--settle` minutes after reopen, used as the true price |
| `gap` | `p_reopen / p_close - 1` |
| `markout_usd` | LP profit/loss on all swaps during the window, valued at `p_reopen`, fees included. **Negative = LPs lost** |
| `fees_usd` | Fees earned on those swaps |
| `notional_usd` | Value of in-range liquidity at the close (`2·L·√P`) |
| `markout_bps` | `markout_usd / notional_usd` in basis points |
| `il_full_range` | Impermanent loss a full-range LP would see from `gap` |

`report` sums these per pool, lists the worst windows, and applies the
payout rule in `contracts/src/GapCoverMath.sol` to estimate the surcharge
needed on closed-window volume.

## How it works without an archive node

The public RPC keeps no historical state, so `eth_call` at an old block fails.
Every Uniswap Swap event already carries the pool price after the swap,
so prices are rebuilt from logs. Block numbers for timestamps come from a
batched search over block headers (`gapscan/blocks.py`).

## Limits (read before trusting numbers)

- **Pool-based reference price.** `p_reopen` comes from the pool itself after
  arbitrage resumes, not from Chainlink. Thin pools may not converge within
  the settle time. Chainlink support is the next step (see
  `docs/research-plan.md`).
- **Short history.** Mainnet launched in July 2026, so there are about 17
  windows so far.
- **Pool-level, not position-level.** Markout is for the pool as a whole.
  Concentrated positions out of range at reopen fare differently.
- **Notional is virtual.** For concentrated liquidity, `2·L·√P` overstates
  real deposits, so `markout_bps` is conservative (small).
- **Holiday rule is an assumption.** See the `calendar.py` docstring.
