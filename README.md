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

Website: **https://www.bellguard.app** · X: **[@Bellguardapp](https://x.com/Bellguardapp)**

Status: **live on Robinhood Chain mainnet since 2026-10-30, not audited.** Pools: COIN/USDG and
MSTR/USDG on Uniswap v4. Addresses: [`contracts/deployments/4663.json`](contracts/deployments/4663.json).
An audit, legal review and a multisig owner are still outstanding
([launch checklist](docs/launch-checklist.md)). Use only amounts you can afford to lose.

| Contract | Address |
|---|---|
| MarketCalendar | `0x8eeE13759042754C7a524030C09c7628BD580407` |
| CoverVault (bgUSDG) | `0x4712BAc5Bfd40Fc0bAb7f4270890Bdcd9ba238a8` |
| BellguardHook | `0x26ba8a6CA4028DF9C655072F63BC316475542ac4` |
| BellguardClaims | `0x91d110aACf2FFc7d19F99B1D1E8529928700dDdE` |

**First findings** ([full write-up](docs/findings-2026-10.md)): across 65 pool-weekends
on the five largest stock pools (Jul to Oct 2026), LPs lost money in only 4, and none
crossed a 1% deductible. Bellguard is therefore designed as low-cost **tail cover** for
large reopen gaps, not as a weekly loss refund.

## Repository

| Path | What's there |
|---|---|
| [`research/`](research/) | `gapscan`: measures historical gaps and LP losses from on-chain data and estimates the premium |
| [`contracts/`](contracts/) | Foundry project: `BellguardHook` (Uniswap v4), `CoverVault` (ERC-4626), `BellguardClaims`, `MarketCalendar`, `GapCoverMath`; deploy scripts; 62 tests |
| [`keeper/`](keeper/) | Settlement keeper (GitHub Actions, hourly) |
| [`web/`](web/) | Website and app (static), live at [bellguard.app](https://www.bellguard.app) |
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

Experimental software, deployed without an audit. Not a regulated insurance product.
Funds can be lost.
