# Bellguard

> Your liquidity, covered until the opening bell.

**Gap cover for liquidity providers in Robinhood stock-token pools on
Robinhood Chain.**

Stock tokens trade on-chain around the clock, but the stock market behind
them closes every weekend and on US holidays. During those hours tokens
can't be minted or redeemed and price feeds pause, yet pools keep trading.
When the market reopens, the pool snaps to the real price and LPs absorb the
gap. Bellguard charges a small, visible surcharge on closed-market swaps,
puts it in an underwriter vault, and pays LPs when a gap actually hurts them.
Premiums rise around earnings and other scheduled events.

Status: **Phase 0, research.** Nothing is deployed.

## Repository

| Path | What's there |
|---|---|
| [`research/`](research/) | `gapscan`: measures historical gaps and LP losses from on-chain data and estimates the premium |
| [`contracts/`](contracts/) | Foundry project: `MarketCalendar` (closed windows and earnings windows) and `GapCoverMath` (pricing and payout rules), with tests |
| [`docs/design.md`](docs/design.md) | Product and protocol design, open questions |
| [`docs/research-plan.md`](docs/research-plan.md) | Phase 0 plan and the go/no-go gate |
| [`docs/robinhood-chain.md`](docs/robinhood-chain.md) | Verified addresses and facts about Robinhood Chain |

## Quick start

```bash
git clone --recurse-submodules https://github.com/pauly-zyz/bellguard
cd bellguard

# Research (Python 3.11+, no dependencies)
cd research
python -m gapscan discover
python -m gapscan scan --only TSLA,NVDA,SPY
python -m gapscan report
python -m unittest discover -s tests

# Contracts (Foundry)
cd ../contracts
forge test
```

## Roadmap

1. **Phase 0: data.** Measure gaps and LP losses, and price the cover. *(in progress)*
2. **Phase 1: testnet.** v4 hook, cover vault and settlement on Robinhood Chain testnet (46630).
3. **Phase 2: guarded mainnet.** A few tickers with low caps, after an audit.
4. **Phase 3: expansion.** More tickers, earnings calendar feeds, a more decentralised calendar.

## Ringkasan (Bahasa Indonesia)

Bellguard memberi perlindungan ("cover") bagi penyedia likuiditas (LP) di pool
token saham Robinhood Chain. Saat bursa saham tutup (akhir pekan dan hari libur
AS), token tetap diperdagangkan, tetapi harga aslinya tidak bergerak. Ketika
bursa buka, harga pool melompat ke harga sebenarnya dan LP menanggung
kerugiannya. Bellguard memungut biaya kecil dan transparan dari swap saat bursa
tutup, menyimpannya di kas penjamin, lalu membayar LP saat gap benar-benar
merugikan mereka. Premi naik di sekitar jadwal earnings. Saat ini proyek ada di
**Fase 0 (riset data)**.

## Disclaimer

Research code. Not audited. Not a regulated insurance product. Do not use
with real funds.
