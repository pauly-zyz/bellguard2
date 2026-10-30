# Settlement keeper

After each closed window, `BellguardClaims.settle(pool, window)` fixes the pool's loss from the
Chainlink price. Anyone may call it from **reopen + 1 hour to reopen + 3 hours**; after that only
the owner can (until the claim deadline). `settle.mjs` finds windows in that slot and settles every
pool that traded while the market was closed. Pools with no closed-market swaps are skipped, so most
runs send nothing.

## Automatic (GitHub Actions)

`.github/workflows/keeper.yml` runs every hour at :17.

1. Create a **new, dedicated** wallet for the keeper (not your owner wallet) and send it a little
   ETH on Robinhood Chain. One settlement costs about 0.000002 ETH, so 0.0005 ETH lasts a long time.
2. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `KEEPER_PRIVATE_KEY`, value: that wallet's private key
   - Optional: `RPC_URL` with a paid Robinhood Chain RPC endpoint
3. Check it: **Actions → Settlement keeper → Run workflow** (leave "dry run" ticked first).

Without the secret the workflow still runs, in dry-run mode: it reports what it would settle.

## Manual

```bash
cd keeper && npm install
DRY_RUN=1 npm run settle                      # report only
KEEPER_PRIVATE_KEY=0x… npm run settle         # settle what's due
```

Or press **Settle window** in the app (window number from the calendar, pool picker at the top).
