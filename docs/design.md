# Bellguard design (draft v0.1)

> Your liquidity, covered until the opening bell.

## Problem

Robinhood stock tokens trade on-chain 24/7, but the real market behind them
does not. From Saturday 02:00 to Monday 02:00 Central European Time, and on
US market holidays, tokens cannot be minted or redeemed and the Chainlink
stock feeds stop updating. Pools keep trading anyway. Whoever trades against
LPs during that window knows more about Monday's price than the pool does.
When the market reopens and arbitrage pulls the pool back to the real price,
LPs absorb the gap.

Existing hooks (Gapguard, v4market's weekend guard, Hookr Market Guard) only
raise fees while the market is closed. Nobody pays LPs back when a gap
actually hits them. Robinhood's own insurance covers hacks, not price moves.

## Product

Bellguard is gap cover for LPs in stock-token pools:

1. **Premium.** While the market is closed, swaps pay a small, clearly shown
   surcharge. It rises around earnings and other scheduled events. The
   surcharge goes to the cover vault.
2. **Vault.** Underwriters deposit USDG and earn the premiums. Withdrawals
   are locked during closed windows and while claims are being settled.
3. **Settlement.** Once the market has reopened and settled, each closed
   window gets a measured LP loss. LPs whose liquidity was in the pool for
   the whole window are paid above a deductible, up to a cap.

## Components

| Component | Status | Role |
|---|---|---|
| `MarketCalendar` | **Built and tested** (`contracts/src`) | Closed windows and per-asset event windows (earnings), published ahead of time. Nothing can change less than `minNotice` before it starts. |
| `GapCoverMath` | **Built and tested** | Surcharge, payout (deductible and cap) and pro-rata rules. Mirrored by the research tool. |
| `gapscan` | **Built and tested** (`research/`) | Measures historical gaps and LP markouts, and estimates break-even premiums. |
| `BellguardHook` | Next | Uniswap v4 hook: reads the calendar, charges the surcharge, tracks which positions were in range for the whole window. |
| `CoverVault` | Next | ERC-4626 USDG vault for underwriters, with withdrawal locks. |
| `Settlement` | Next | Fixes reference prices after reopen and pays claims. |

## Key design choices

- **Measured loss with a deductible and cap, not a promise of full
  indemnity.** Payout = min(cap, max(0, loss - deductible)). Both are
  percentages of position notional. Simple, bounded, auditable.
- **Swappers pay the premium, not LPs.** LPs get cover automatically, which
  is the reason to provide liquidity in a Bellguard pool.
- **Anti-gaming.** Only liquidity present from close to reopen is covered,
  so nobody can add liquidity just before reopen to collect a claim. The
  calendar cannot be edited near a window, and past windows are immutable.
- **Vault run protection.** Withdrawals are locked during closed windows and
  settlement. Payouts per window are capped at a share of the vault and
  paid pro rata above that.
- **Corporate actions are not gaps.** Splits and dividends change the
  ERC-8056 multiplier. Chainlink prices already include it. Pool prices must
  be adjusted before measuring a gap.
- **Reference price after settling.** The reopen price is taken 15 to 60
  minutes after reopen, from Chainlink once feeds update, with staleness
  checks.

## Strategic issue: where the liquidity is

Research on 2026-10-30 found that stock/USDG and stock/WETH liquidity is in
**Uniswap v3** pools (202 pools with in-range liquidity). Uniswap v4 hosts
memecoin pools quoted in stock tokens, but no stock/USDG pools. A v4 hook only
protects v4 pools. Options:

1. **Bellguard v4 pools (recommended start).** Launch covered stock/USDG
   pools on v4 and use the cover as the reason LPs move over. The full
   design above applies.
2. **Cover for existing v3 LPs.** No hook. LPs register their v3 position
   NFT and pay the premium from their fees. Reaches the existing liquidity,
   but premium collection and position checks become harder.
3. **Both:** start with 1, add 2 once settlement is proven.

## Open questions

- Will Robinhood Chain feeds adopt Chainlink's 24/7 equity pricing? Weekend
  reference prices would change what a "gap" is.
- What is the holiday behaviour of the 24/5 session? (The calendar assumes a
  full 24-hour closure; confirm it.)
- Legal wrapper and wording. "Cover", not "insurance", until advised.
- Concentrated-liquidity loss measurement per position (v4 position
  tracking) versus pool-level measurement.
