# Bellguard gap scan report

Pool-windows measured: 70 (usable: 65, skipped: 5). Chainlink-referenced: 0.

Closed windows covered: 14 (2026-07-25 to 2026-10-24).

## Headline

- LPs lost money in **4 of 65** pool-windows (LP markout below zero, fees included).
- Net LP markout over all closed windows: **$181,614** (positive = LPs gained).
- Worst: NVDA/USDG v3 0.05% on 2026-09-12: $-9,660, gap -1.69%.
- Reopen gaps: median 0.58%, largest 1.69%; above 3%: 0, above 5%: 0.

## Per pool

| Pool | Windows | Closed-window volume | Fees earned | LP markout (pool ref) | LP markout (Chainlink ref) | Windows with LP loss | Largest abs gap |
|---|---:|---:|---:|---:|---:|---:|---:|
| NVDA/USDG v3 0.05% | 14 | $214,703,580 | $107,470 | $73,338 | n/a | 1 | 1.69% |
| SPCX/USDG v3 0.05% | 14 | $126,947,002 | $63,506 | $51,785 | n/a | 2 | 1.20% |
| TSLA/USDG v3 0.3% | 14 | $13,653,628 | $40,919 | $39,626 | n/a | 0 | 1.47% |
| SPY/USDG v3 0.05% | 10 | $5,974,460 | $2,989 | $2,994 | n/a | 1 | 0.74% |
| COIN/WETH v3 0.3% | 13 | $5,079,124 | $15,234 | $13,871 | n/a | 0 | 1.60% |

## Worst pool-windows for LPs

| Window | Pool | Gap | LP markout | Basis | Markout (bps of notional) |
|---|---|---:|---:|---|---:|
| 2026-09-12 weekend | NVDA/USDG v3 0.05% | -1.69% | $-9,660 | pool | -0.17 |
| 2026-09-12 weekend | SPCX/USDG v3 0.05% | -1.20% | $-536 | pool | -0.01 |
| 2026-10-10 weekend | SPCX/USDG v3 0.05% | +0.98% | $-215 | pool | -0.07 |
| 2026-10-17 weekend | SPY/USDG v3 0.05% | +0.74% | $-28 | pool | -0.02 |
| 2026-10-10 weekend | SPY/USDG v3 0.05% | +0.24% | $7 | pool | +0.01 |
| 2026-10-03 weekend | SPY/USDG v3 0.05% | +0.19% | $14 | pool | +0.01 |
| 2026-10-03 weekend | TSLA/USDG v3 0.3% | +0.63% | $17 | pool | +0.01 |
| 2026-07-25 weekend | TSLA/USDG v3 0.3% | +1.06% | $28 | pool | +1.14 |
| 2026-08-15 weekend | COIN/WETH v3 0.3% | +0.28% | $30 | pool | +0.11 |
| 2026-10-10 weekend | TSLA/USDG v3 0.3% | +0.23% | $51 | pool | +0.05 |

## Premium estimate (cover every window)

Terms: deductible 25 bps of notional, cap 500 bps of notional per window, loading x1.5.

- Pool-windows with a payout: 0 of 65
- Total payouts: $0
- Closed-window swap volume: $366,357,794
- Break-even surcharge on closed-window swaps: 0.00 bps
- With loading: **0.00 bps** of closed-window volume

## By LP range width

Same windows, expressed as a share of the capital of an LP whose range is centred on the price. Narrow ranges put less capital behind the same liquidity, so the same dollar loss is a bigger percentage.

| LP range | Worst window (bps of capital) | Windows with loss > 25 bps | Payouts under the terms above | Break-even surcharge (bps of volume) |
|---|---:|---:|---:|---:|
| full range | -0.2 | 0 | $0 | 0.00 |
| ±20% range | -2.0 | 0 | $0 | 0.00 |
| ±5% range | -7.2 | 0 | $0 | 0.00 |

The sample is short. Treat these numbers as a first look, not as final pricing. See docs/research-plan.md for next steps.
