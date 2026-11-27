# Bellguard Perps

Long or short stock prices with leverage, settled in a USD stablecoin, against a liquidity
vault. Built for stocks, whose prices stop over the weekend. Status: **testnet prototype on
Elysium testnet (chain 99801), not audited.**

## Contracts (`contracts/src/perps/`)

| Contract | Role |
|---|---|
| `PerpEngine` | Markets, positions, fees, liquidation, bell mode |
| `PerpVault` | ERC-4626 LP vault; counterparty to every trade; reserves each position's profit cap |
| `PushPriceFeed` | Chainlink-compatible feed written by a keeper (test networks without a stock oracle) |
| `TestUSD` | Test stablecoin (tUSD) with an hourly 10,000 faucet |
| `MarketCalendar` | Shared with the cover product: published closed windows |

## Bell mode

1. **Paused while closed.** Opening, closing and liquidations revert while the calendar says the
   market is closed, so nobody trades the frozen Friday price with weekend news. Adding
   collateral still works.
2. **Fresh price after reopen.** Trading needs a price published after the latest reopen.
3. **Pre-close leverage cap.** In the last 2 hours before a close, new positions are limited to
   5x, and anyone can trim older positions down to 5x for a 0.05% keeper fee.
4. **Weekend borrow ×3.** Borrow fees accrue three times faster over closures. LPs carry the
   reopen gap and are paid for it.

## Risk limits

- Profit per position is capped at 9x its collateral; the cap is reserved in the vault until the
  position closes, and LPs can only withdraw unreserved assets.
- Reserves are limited to 80% of vault assets; open interest is capped per market and side.
- 1% maintenance margin, 0.2% liquidation reward, 0.08% open and close fees, 0.05% spread,
  0.03% per day borrow fee. Max leverage 20x.

## Known limits (before any mainnet use)

- **Oracle.** On Elysium testnet prices are pushed by a trusted keeper that copies Chainlink
  feeds from chain 4663. Production needs a real stock oracle on the target chain (for example
  Pyth or Chainlink) and two-step orders to stop oracle front-running.
- **Vault takes the net skew.** There is no funding rate between longs and shorts yet.
- **Borrow accrual** assumes at most one closure between updates; the keeper pokes markets.
- **Audit and legal review** are required before real funds.

## Run it

```bash
cd contracts
forge test --match-contract PerpsTest     # 22 tests incl. a solvency fuzz test
KEEPER=<updater address> WINDOWS_JSON=script/windows-2026-11-to-2027-02.json \
  forge script script/DeployPerps.s.sol --rpc-url https://testnet-rpc.elysium.kinetiq.xyz \
  --private-key $PK --broadcast --slow     # writes deployments/perps-99801.json
cd ../keeper && PERPS_KEEPER_KEY=... npm run perps
```

Then copy `deployments/perps-99801.json` into `deployment` in `web/perps-config.js`.
