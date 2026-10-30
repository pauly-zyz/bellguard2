# Launch checklist

Bellguard is built and tested, but it is **not ready for real funds**. This list
is what stands between the repository and a mainnet launch, in order.

## 1. Evidence (Phase 0)

- [x] Gap and LP-markout measurement tool (`research/gapscan`)
- [x] First results: 5 major pools, late July to October 2026, pool-referenced
- [ ] Chainlink-referenced results for the same windows (tool supports it; the
      public RPC rate limit makes the full history slow, so use a paid RPC)
- [ ] Position-level loss (rebuild v3 positions from Mint/Burn)
- [ ] Decide final terms: surcharge, deductible, cap, window budget

## 2. Testnet (Phase 1)

- [x] Contracts: hook, vault, claims, calendar (62 tests incl. both token orientations)
- [x] Deployment dry run against live Robinhood Chain testnet state
- [ ] Broadcast `DeployTestnetDemo` with a funded testnet key (`docs/deploy.md`)
- [x] Website live on Vercel (bellguard2.vercel.app), deployed from `web/` on every push to main
- [ ] Put the demo addresses in `web/config.js` after the testnet deployment
- [ ] Run a settlement keeper for at least four real weekends
- [ ] Invite testers: LPs claim, underwriters deposit and withdraw

## 3. Security

- [ ] Independent audit of `src/` (hook, vault, claims, calendar)
- [ ] Review the known limitations below with the auditor
- [ ] Bug bounty before and after launch
- [ ] Owner is a multisig (e.g. Safe) with a timelock on parameter changes
- [ ] Monitoring: premiums, vault assets, settlement success, feed staleness

### Known limitations to review

- **Flow accounting uses post-swap liquidity.** A swap that crosses initialized
  ticks divides its flow by the liquidity at the end of the swap, not the
  liquidity at each step. Claims are close to exact for positions covering the
  whole traded range, which is required to claim, but per-unit flows can be off
  when liquidity changes inside that range.
- **Stock-token premiums go to the treasury**, not the vault. They must be
  converted and sent to the vault by an operator.
- **Calendar and stock registry are owner-controlled.** Changes need
  `minNotice` lead time, but the owner is trusted to publish correct windows.
- **Settlement price** is the Chainlink value when `settle` is called inside the
  slot. Anyone can call it in the public slot, which limits but doesn't remove
  timing choice. A TWAP of feed updates would be stronger.
- **Positions must stay untouched** from before the close until the claim.
  Collecting fees through PositionManager counts as a change (it pokes the position).
- **Only USDG-quoted pools** are supported.

## 4. Legal and operations

- [ ] Legal review of the product in target jurisdictions. Present it as
      "cover", not insurance, until advised otherwise.
- [ ] Stock tokens are unavailable in the US, Canada, UK, Switzerland, UAE and
      sanctioned jurisdictions. Geo-restrict the website accordingly.
- [ ] Terms of use and risk disclosures for LPs and underwriters
- [ ] Check Robinhood Stock Token terms for use in third-party pools
- [ ] Trademark search for "Bellguard"; avoid any Robinhood branding

## 5. Mainnet (Phase 2)

Deployed 2026-10-30 by a temporary deploy key `0x44cb17C50b79537c7db2E64FC1163a4b6eC3d404`
(owner of all contracts and treasury until handed over). Settings: 0.10% closed-market
surcharge, 1% deductible, 5% cap, 5% of vault per window, 37 closed windows to June 2027,
COIN and MSTR registered with Chainlink proxies.

- [x] Treasury set to the project wallet `0x4b08C1DbE28e4e260037299e8cb4B34c7FBe2195`
- [x] Ownership of calendar, vault, hook and claims proposed to the project wallet
- [ ] **Project wallet accepts ownership** (app → connect wallet → Admin → Accept ownership)
- [ ] Later: move ownership from the project wallet to a multisig

- [x] Deploy with `script/Deploy.s.sol`
- [ ] Verify source on the explorer
- [x] Publish the calendar months ahead (to June 2027)
- [ ] Add earnings events
- [x] Register two stocks with Chainlink feeds (COIN, MSTR)
- [ ] Low caps: small vault, low `MAX_WINDOW_BPS`, then raise gradually
