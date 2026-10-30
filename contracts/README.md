# Bellguard contracts

Foundry project. Solidity 0.8.26, EVM `cancun` (the target for Uniswap v4 hooks).

| Contract | What it does |
|---|---|
| `src/MarketCalendar.sol` | Closed-market windows and per-asset event windows (earnings), published ahead of time. Changes need `minNotice` lead time, and past windows can't be edited. |
| `src/GapCoverMath.sol` | Surcharge, payout (deductible + cap) and pro-rata rules. |

Coming next: `BellguardHook` (Uniswap v4), `CoverVault` (ERC-4626), `Settlement`.
See `../docs/design.md`.

## Build and test

```bash
git submodule update --init --recursive   # forge-std
cd contracts
forge build
forge test        # unit + fuzz tests (1,000 runs each)
```

The calendar windows come from the research tool. `python -m gapscan windows`
prints them; a publishing script will turn that list into `addClosures` calls.

Not audited. Do not deploy with real funds.
