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

Status: **built and tested, not deployed.** Contracts, research tool, deploy scripts and
website are done; a testnet deployment was dry-run against live Robinhood Chain testnet
state. Mainnet needs an audit, legal review and a multisig first
([launch checklist](docs/launch-checklist.md)).

**First findings** ([full write-up](docs/findings-2026-10.md)): across 65 pool-weekends
on the five largest stock pools (Jul to Oct 2026), LPs lost money in only 4, and none
crossed a 1% deductible. Bellguard is therefore designed as low-cost **tail cover** for
large reopen gaps, not as a weekly loss refund.

## Repository

| Path | What's there |
|---|---|
| [`research/`](research/) | `gapscan`: measures historical gaps and LP losses from on-chain data and estimates the premium |
| [`contracts/`](contracts/) | Foundry project: `BellguardHook` (Uniswap v4), `CoverVault` (ERC-4626), `BellguardClaims`, `MarketCalendar`, `GapCoverMath`; deploy scripts; 62 tests |
| [`web/`](web/) | Website and app (static; deployed by GitHub Pages) |
| [`docs/design.md`](docs/design.md) | Product and protocol design, open questions |
| [`docs/research-plan.md`](docs/research-plan.md) | Phase 0 plan and the go/no-go gate |
| [`docs/robinhood-chain.md`](docs/robinhood-chain.md) | Verified addresses and facts about Robinhood Chain |
| [`docs/findings-2026-10.md`](docs/findings-2026-10.md) | First research results and what they mean for the product |
| [`docs/deploy.md`](docs/deploy.md) | Testnet demo and production deployment runbook |
| [`docs/launch-checklist.md`](docs/launch-checklist.md) | Everything left before real funds, incl. known limitations |

## Quick start

```bash
git clone --recurse-submodules https://github.com/pauly-zyz/bellguard2
cd bellguard2

# Research (Python 3.11+, no dependencies)
cd research
python -m gapscan discover
python -m gapscan scan --only TSLA,NVDA,SPY
python -m gapscan report
python -m unittest discover -s tests

# Contracts (Foundry)
cd ../contracts
forge test

# Website (any static server)
cd ../web && python -m http.server
```

## Roadmap

1. **Phase 0: data.** Measure gaps and LP losses, and price the cover. *(first results done; Chainlink-referenced run next)*
2. **Phase 1: testnet.** v4 hook, cover vault and settlement on Robinhood Chain testnet (46630). *(built and dry-run; broadcast needs a funded key)*
3. **Phase 2: guarded mainnet.** A few tickers with low caps, after an audit.
4. **Phase 3: expansion.** More tickers, earnings calendar feeds, a more decentralised calendar.

## Ringkasan (Bahasa Indonesia)

Bellguard memberi perlindungan ("cover") bagi penyedia likuiditas (LP) di pool
token saham Robinhood Chain. Saat bursa saham tutup (akhir pekan dan hari libur
AS), token tetap diperdagangkan, tetapi harga aslinya tidak bergerak. Ketika
bursa buka, harga pool melompat ke harga sebenarnya dan LP menanggung
kerugiannya. Bellguard memungut biaya kecil dan transparan dari swap saat bursa
tutup, menyimpannya di kas penjamin, lalu membayar LP saat gap benar-benar
merugikan mereka. Premi naik di sekitar jadwal earnings. Kontrak, alat riset, skrip
deploy dan website sudah selesai dan teruji; peluncuran mainnet menunggu audit, kajian
hukum dan multisig.

## Disclaimer

Research code. Not audited. Not a regulated insurance product. Do not use
with real funds.
