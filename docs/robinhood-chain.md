# Robinhood Chain: verified facts

What Bellguard relies on, and how each item was checked. Last checked: 2026-10-30.

## Network

| Item | Value | How it was checked |
|---|---|---|
| Chain ID | 4663 (`0x1237`) | `eth_chainId` on the public RPC |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | Live calls. Rate-limited, rejects Python's default User-Agent, no historical state (not an archive node) |
| `eth_getLogs` limits | 10,000,000 blocks and 10,000 logs per request | Error messages from the RPC |
| Explorer | robinhoodchain.blockscout.com | Third-party guides (not reachable from the build sandbox) |

## Contracts

| Contract | Address | How it was checked |
|---|---|---|
| Uniswap v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | Uniswap deployments page; live `Initialize` logs decode correctly |
| Uniswap v4 StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | Third-party config (rh-stockpair-oracle) |
| Uniswap v3 Factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | `getPool` returns live pools with liquidity |
| Robinhood StockFactory | `0x4783c67b63de2b358ac5951a7d41f47a38f3c046` | 212 creation events. Data decodes as (token, name, symbol). TSLA and NVDA addresses match public sources |
| USDG (6 decimals) | `0x5fc5360d0400a0fd4f2af552add042d716f1d168` | Quote side of the largest stock pools |
| WETH | `0x0bd7d308f8e1639fab988df18a8011f41eacad73` | Quote side of stock pools; WETH/USDG v3 pool prices ETH at about $2,200 |
| TSLA token | `0x322f0929c4625ed5bad873c95208d54e1c003b2d` | StockFactory event + public sources |
| NVDA token | `0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec` | StockFactory event + public sources |

## Market structure (findings)

- **Stock/USD liquidity is on Uniswap v3, not v4.** On 2026-10-30 there were 202 v3 pools pairing a stock token with USDG or WETH that had in-range liquidity. On v4, TSLA appears in 5,229 pools, and every one pairs it with a memecoin. There is no TSLA/USDG, TSLA/WETH or TSLA/ETH v4 pool. Reports that "v4 holds 73% of stock-token DEX liquidity" seem to count those memecoin pools.
- **Mint and redeem window:** Robinhood's docs give the tokenization window as Monday 02:00 to Saturday 02:00 Central European Time. The Chainlink stock feeds follow 24/5 market hours and keep the last value while closed. The tokens keep trading on-chain outside the window. That is the gap Bellguard covers.
- **Chainlink prices already include the ERC-8056 multiplier** (splits and dividends), per Robinhood's developer guide. Don't apply it twice.
- **Chainlink announced a 24/7 equity pricing service on 2026-10-29.** It is not confirmed for Robinhood Chain feeds. If it is adopted, settlement could use weekend reference prices, which would change the product design. Watch this.

## Data sources the build sandbox could not reach

These need checking from a normal machine:

- `https://api.robinhood.com/rhj/assets`: official stock-token list (includes multipliers)
- `https://api.robinhood.com/rhj/corporate-actions`: split and dividend calendar
- `https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`: Chainlink feed addresses
- `https://docs.robinhood.com/chain/`: official docs

## Sources

- Uniswap v4 deployments: https://developers.uniswap.org/docs/protocols/v4/deployments
- Robinhood Chain RPC (Dwellir): https://www.dwellir.com/docs/robinhood
- Stock tokens and StockFactory (Envio guide): https://docs.envio.dev/blog/index-robinhood-chain-data
- Chainlink tokenized equity feeds: https://docs.chain.link/data-feeds/tokenized-equity-feeds
- Chainlink 24/7 service: https://www.kucoin.com/news/flash/chainlink-launches-24-7-service-for-traditional-asset-pricing
- rh-stockpair-oracle (address cross-check): https://github.com/MeMikko/rh-stockpair-oracle
