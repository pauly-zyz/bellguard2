// Bellguard Perps keeper (test networks).
//
// Each run:
//  1. Mirror prices: copy every market's latest Chainlink answer (and its original timestamp)
//     from the source chain into the PushPriceFeed on the perps chain.
//  2. Liquidate positions below maintenance margin.
//  3. In the pre-close window, trim positions above the weekend leverage cap.
//  4. Poke markets whose borrow index hasn't moved for 6 hours (keeps weekend fees exact).
//
// Env:
//   PERPS_RPC          perps chain RPC (Elysium testnet: https://testnet-rpc.elysium.kinetiq.xyz)
//   PERPS_KEEPER_KEY   key of the feed updater / keeper wallet (required unless DRY_RUN=1)
//   SOURCE_RPC         price source chain RPC [https://rpc.mainnet.chain.robinhood.com]
//   DEPLOYMENT         [../contracts/deployments/perps-99801.json]
//   DRY_RUN=1          report only

import fs from "fs";
import { createPublicClient, createWalletClient, http, parseAbi, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = (p) => new URL(p, import.meta.url).pathname;
const DRY = process.env.DRY_RUN === "1";
const dep = JSON.parse(fs.readFileSync(process.env.DEPLOYMENT || here("../contracts/deployments/perps-99801.json"), "utf8"));
const sources = JSON.parse(fs.readFileSync(here("./perps-sources.json"), "utf8"))["4663"];
const PERPS_RPC = process.env.PERPS_RPC || "https://testnet-rpc.elysium.kinetiq.xyz";
const SOURCE_RPC = process.env.SOURCE_RPC || "https://rpc.mainnet.chain.robinhood.com";

const chain = defineChain({ id: dep.chainId, name: "perps", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: [PERPS_RPC] } } });
const pub = createPublicClient({ chain, transport: http(PERPS_RPC, { retryCount: 4, retryDelay: 1500 }) });
const src = createPublicClient({ transport: http(SOURCE_RPC, { retryCount: 5, retryDelay: 1500 }) });

const FEED = parseAbi([
  "function latestRoundData() view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80)",
  "function update(int256 answer, uint256 updatedAt)",
]);
const ENGINE = parseAbi([
  "function nextPositionId() view returns (uint256)",
  "function inPreCloseWindow() view returns (bool)",
  "function position(uint256) view returns ((address owner, uint32 market, bool isLong, uint256 collateral, uint256 size, uint256 entryPrice, uint256 borrowIndex, uint256 maxProfit, uint64 openedAt))",
  "function positionValue(uint256) view returns (int256 equity, int256 pnl, uint256 borrowFee, uint256 closeFee, bool liquidatable)",
  "function getParams() view returns ((uint16 openFeeBps, uint16 closeFeeBps, uint16 spreadBps, uint16 maintenanceBps, uint16 liquidationFeeBps, uint16 deleverageFeeBps, uint32 maxProfitBps, uint32 borrowBpsPerDay, uint16 closedBorrowMultiplier, uint16 maxLeverage, uint16 weekendMaxLeverage, uint32 preCloseWindow, uint16 maxUtilizationBps, uint64 minCollateral))",
  "function market(uint256) view returns ((address feed, uint32 maxPriceAge, bool active, uint256 maxOpenInterest, uint256 longOpenInterest, uint256 shortOpenInterest, uint256 borrowIndex, uint64 lastAccrual, string symbol))",
  "function liquidate(uint256 id)",
  "function deleverage(uint256 id)",
  "function poke(uint256 marketId)",
]);

const account = DRY ? null : privateKeyToAccount(process.env.PERPS_KEEPER_KEY);
const wallet = account ? createWalletClient({ account, chain, transport: http(PERPS_RPC) }) : null;
let sent = 0;
async function send(label, req) {
  if (DRY) { console.log("  (dry run) " + label); return; }
  try {
    const { request } = await pub.simulateContract({ account, ...req });
    const hash = await wallet.writeContract(request);
    const r = await pub.waitForTransactionReceipt({ hash });
    sent++;
    console.log("  " + label + ": " + r.status + " " + hash);
    if (r.status !== "success") process.exitCode = 1;
  } catch (e) {
    console.log("  " + label + " failed: " + (e.shortMessage || e.message).split("\n")[0]);
    process.exitCode = 1;
  }
}

async function main() {
  const now = (await pub.getBlock()).timestamp;
  console.log(`perps chain ${dep.chainId}, block time ${new Date(Number(now) * 1000).toISOString()}, ${dep.markets.length} markets`);

  // 1. prices
  for (const m of dep.markets) {
    const source = sources[m.symbol];
    if (!source) { console.log(`  ${m.symbol}: no source feed`); continue; }
    const [s, t] = await Promise.all([
      src.readContract({ address: source, abi: FEED, functionName: "latestRoundData" }),
      pub.readContract({ address: m.feed, abi: FEED, functionName: "latestRoundData" }),
    ]);
    const [, answer, , updatedAt] = s;
    if (updatedAt <= t[3]) continue; // already mirrored
    if (updatedAt > now) { console.log(`  ${m.symbol}: source time ahead of perps chain, next run`); continue; }
    await send(`${m.symbol} price ${(Number(answer) / 1e8).toFixed(2)}`, { address: m.feed, abi: FEED, functionName: "update", args: [answer, updatedAt] });
  }

  // 2 + 3. positions
  const [next, preClose, p] = await Promise.all([
    pub.readContract({ address: dep.engine, abi: ENGINE, functionName: "nextPositionId" }),
    pub.readContract({ address: dep.engine, abi: ENGINE, functionName: "inPreCloseWindow" }),
    pub.readContract({ address: dep.engine, abi: ENGINE, functionName: "getParams" }),
  ]);
  let open = 0;
  for (let id = 1n; id < next; id++) {
    const pos = await pub.readContract({ address: dep.engine, abi: ENGINE, functionName: "position", args: [id] });
    if (pos.size === 0n) continue;
    open++;
    let v;
    try { v = await pub.readContract({ address: dep.engine, abi: ENGINE, functionName: "positionValue", args: [id] }); }
    catch { continue; } // market closed or price not usable: nothing can be done now
    const [equity, , , , liquidatable] = v;
    if (liquidatable) { await send(`liquidate #${id}`, { address: dep.engine, abi: ENGINE, functionName: "liquidate", args: [id] }); continue; }
    if (preClose && equity > 0n && pos.size > equity * BigInt(p.weekendMaxLeverage)) {
      await send(`deleverage #${id}`, { address: dep.engine, abi: ENGINE, functionName: "deleverage", args: [id] });
    }
  }

  // 4. poke stale borrow indexes
  for (const m of dep.markets) {
    const mk = await pub.readContract({ address: dep.engine, abi: ENGINE, functionName: "market", args: [BigInt(m.market)] });
    if (now - mk.lastAccrual > 6n * 3600n) await send(`poke ${m.symbol}`, { address: dep.engine, abi: ENGINE, functionName: "poke", args: [BigInt(m.market)] });
  }
  console.log(`done: ${open} open positions, ${sent} transactions`);
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
