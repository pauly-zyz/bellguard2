# Deploying Bellguard

Robinhood Chain uses the same Uniswap v4 PoolManager address on mainnet (4663)
and testnet (46630): `0x8366a39c…e40951`. The standard CREATE2 factory
(`0x4e59b448…4956C`) exists on both, and the hook address is mined against it.

> **Mainnet:** do not deploy with real funds before an audit, a legal review
> and a multisig owner are in place. See `docs/launch-checklist.md`.

## 0. Tooling

```bash
git clone --recurse-submodules https://github.com/pauly-zyz/bellguard2
cd bellguard2/contracts
forge test                    # 62 tests, must all pass
cast wallet import deployer --interactive
```

## 1. Testnet demo (one command)

Deploys mock USDG, a mock stock token (`dTSLA`), a settable price feed, every
Bellguard contract, v4 test routers, a pool with about $1M liquidity per side, and
a $1M vault deposit. Closed windows come from the research tool.

```bash
cd research && python -m gapscan windows --since 2026-11-01 --until 2027-06-30 \
    --json ../contracts/script/windows.json && cd ../contracts

export TESTNET_RPC=https://rpc.testnet.chain.robinhood.com
WINDOWS_JSON=script/windows.json \
forge script script/DeployTestnetDemo.s.sol:DeployTestnetDemo \
    --rpc-url $TESTNET_RPC --account deployer --broadcast
```

Addresses are written to `contracts/deployments/demo-46630.json`. Copy them into
`web/config.js` to point the website at the demo. A dry run against the live
testnet state (2026-10-30) completed. Estimated gas: about 20M, or roughly
0.0004 testnet ETH.

To demo a gap on testnet: swap during a closed window, then after reopen call
`DemoFeed.set(newPrice)`, `BellguardClaims.settle`, `registerClaim` and,
after the claim period, `payClaim`.

## 2. Production deployment

```bash
export RPC=https://rpc.mainnet.chain.robinhood.com     # use a paid RPC in practice
export USDG=0x5fc5360d0400a0fd4f2af552add042d716f1d168
export POSITION_MANAGER=0x58daec3116aae6d93017baaea7749052e8a04fa7
export OWNER=<multisig>
export TREASURY=<multisig or treasury contract>
# optional: CLOSED_BPS=10 DEDUCTIBLE_BPS=100 CAP_BPS=500 MAX_WINDOW_BPS=2000
#           SETTLE_DELAY=3600 SETTLE_SLOT=7200 CLAIM_PERIOD=172800
#           LOCK_AFTER_REOPEN=345600 MAX_PRICE_AGE=3600 CALENDAR_NOTICE=3600

forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --account deployer --broadcast --verify
```

Then, in order:

1. **Publish the calendar** while the deployer still owns it:
   ```bash
   CALENDAR=<calendar> WINDOWS_JSON=script/windows.json \
   forge script script/Operate.s.sol:PublishCalendar --rpc-url $RPC --account deployer --broadcast
   ```
2. **Hand over the calendar:** `cast send <calendar> "transferOwnership(address)" $OWNER`.
   The multisig then calls `acceptOwnership()` on the calendar and on the vault.
3. **Register stocks** (multisig, as hook owner): `registerStock(stock, chainlinkFeed)`.
   Feed addresses can be found with `gapscan` (Chainlink module) or Chainlink's
   directory. Check `description()` before registering.
4. **Create pools:** `HOOK=<hook> STOCK=<token> forge script script/Operate.s.sol:CreatePool ...`
   sets the pool price from the Chainlink feed.
5. **Seed the vault** with an underwriting deposit before announcing anything.
6. **Run the keeper:** after every reopen, call `settle(poolKey, windowIndex)`
   for each pool inside the public slot (`SETTLE_DELAY` to `SETTLE_DELAY + SETTLE_SLOT`).
   After that only the owner can settle.
7. **Keep the calendar ahead:** publish windows at least a few weeks in advance and
   add earnings windows with `addEvent(stock, {start, end, riskMultiplierBps})`.

## Parameters and their constraints

| Parameter | Default | Constraint |
|---|---|---|
| `CLOSED_BPS` | 10 (0.10%) | ≤ 300, hard-coded in the hook |
| `LOCK_AFTER_REOPEN` | 4 days | ≥ `SETTLE_DELAY + CLAIM_PERIOD` (enforced by BellguardClaims) |
| `MAX_PRICE_AGE` | 1 hour | Chainlink stock feeds have a heartbeat; keep it above that |
| `MAX_WINDOW_BPS` | 2000 (20%) | Share of the vault that one closed window can pay out |
