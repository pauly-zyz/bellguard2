# Bellguard Perps

Long or short stock prices with leverage, settled in a USD stablecoin, against a liquidity
vault. Built for stocks, whose prices stop over the weekend. Target: **Elysium mainnet
(chain 99901), collateral USDC (`0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65`)**. Not audited.

## Markets

34 markets (Chainlink feeds on chain 4663, relayed by the keeper): TSLA, NVDA, AAPL, AMZN, GOOGL,
META, MSFT, PLTR, COIN, MSTR, AMD, CRCL, CRWV, DELL, GME, INTC, IONQ, MU, ORCL, RGTI, RKLB, SNDK,
SPCX, USAR, CLSK; outside the US: ASML and NBIS (Netherlands), BABA (China), TSM (Taiwan);
ETFs: SPY, QQQ, EWY (South Korea), SLV (silver), USO (oil). Add more with `script/UpdatePerps.s.sol`.

**China (Pyth-priced, added 2026-11-28):** PDD, JD, BIDU, NIO, LI, XPEV, TME, BILI, NTES, YUMC, EDU,
BEKE, FUTU, TCOM and the ETFs FXI, KWEB, MCHI. Their feeds are deployed
(`deployments/perps-feeds-99901.json`); the owner lists them with the Trade page's admin button
("Add markets"). The keeper prices them from Pyth Hermes, which needs a Pyth API key
(`PYTH_API_KEY`). Without prices they can't trade: the engine rejects stale or missing prices.
Charts for these markets are built from the feed's own on-chain price updates.

Markets are grouped by country on the Trade page (`country` in `web/perps-config.js`).

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

## Paying with HYPE

The Trade page can take native HYPE instead of USDC. The wallet first swaps HYPE to USDC on
Uniswap v4 (Universal Router `0xA13f7611115752DEB2B13813BDDE16A5073e4b45`, native HYPE/USDC
0.3% pool without hooks, at most 1.5% slippage), then opens the position with exactly the USDC
the swap returned. Positions stay USDC-collateralised and pay out in USDC.

## Risk limits

- **Owner pause** (`setPaused`) stops opening, closing, liquidating and trimming; adding
  collateral stays open. Use it if a price feed misbehaves.
- **Price guard.** The keeper can't move a feed more than 25% in one update; larger real gaps
  need the owner (`forceUpdate`). This limits what a leaked keeper key can do.
- **Ownership.** Feeds belong to the owner wallet from deployment; calendar, vault and engine
  are handed over with a two-step transfer (accept on the Trade page's admin panel).

- Profit per position is capped at 9x its collateral; the cap is reserved in the vault until the
  position closes, and LPs can only withdraw unreserved assets.
- Reserves are limited to 80% of vault assets; open interest is capped per market and side.
- 1% maintenance margin, 0.2% liquidation reward, 0.08% open and close fees, 0.05% spread,
  0.03% per day borrow fee. Max leverage 20x (raised from the 5x launch setting on 2026-11-28).

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
KEEPER=<updater> OWNER=<owner wallet> COLLATERAL=0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65 \
  MAX_OI=2000000000 WINDOWS_JSON=script/windows-2026-11-to-2027-11.json \
  forge script script/DeployPerps.s.sol --rpc-url https://rpc.elysium.kinetiq.xyz \
  --private-key $PK --broadcast --slow     # writes deployments/perps-99901.json
# test network: leave COLLATERAL unset (deploys tUSD with a faucet) and use the testnet RPC
cd ../keeper && PERPS_KEEPER_KEY=... npm run perps
```

Then copy `deployments/perps-99901.json` into `deployment` in `web/perps-config.js`.
The calendar holds closures through November 2027; the owner adds more with `addClosures`.
