# $BLGD holder rewards

Weekly USDC rewards from Bellguard Perps trading fees, for wallets holding at least
**1,000,000 $BLGD** (average balance over the week). Page: [bellguard.app/rewards](https://www.bellguard.app/rewards).

## Rules

1. **Eligible:** time-weighted average BLGD balance over the week ≥ 1,000,000, rebuilt from the
   token's Transfer logs. Contracts (e.g. DEX pools) and burn addresses are excluded; wallets with
   an EIP-7702 delegation count as wallets.
2. **Pool:** `poolShareBps` of the week's fees: open fees, close fees, borrow fees, and the close fee
   of liquidated positions. Week 1 (30 Nov – 7 Dec 2026, UTC): 100%.
3. **Traders first:** an eligible trader gets their own fees back in full (pro rata if the pool is
   smaller). Nobody can get back more than they paid, so wash trading never pays.
4. **Then holders:** what's left (fees from non-eligible traders) is shared by all eligible holders in
   proportion to their average balance.

## Contracts and files

- `RewardsDistributor` (Elysium) `0x578D2Cc9839a5541deeb40e78ed62E752C58C87b`, owner `0x4b08…2195`,
  pays USDC. Each week the owner publishes a Merkle root over cumulative amounts; a claim pays the
  difference to what the wallet already claimed, so one claim collects every unclaimed week.
- `keeper/rewards.mjs` computes a week (`EPOCH=n npm run rewards`) into `web/rewards/epoch-n.json`
  and `latest.json` (amounts, proofs, fees, balances). `keeper/rewards-config.json` holds the weeks and rules.
- `.github/workflows/rewards.yml` runs every Monday 00:23 UTC and commits finished weeks.

## Weekly owner step

Open the Rewards page with the owner wallet: the admin panel shows the week to publish and how much
USDC it needs. **Fund & publish** sends the USDC and publishes the root (two transactions). The USDC
comes from the fees, which sit in the perps vault: withdraw that amount from the vault as LP (or pay
from other funds) before publishing.

To change the rules for later weeks, add the week to `keeper/rewards-config.json` (and to `rewards.weeks`
in `web/perps-config.js` for the page).
