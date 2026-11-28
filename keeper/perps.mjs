// Bellguard Perps keeper (Elysium).
//
// Each run:
//  1. Mirror prices: copy every market's latest Chainlink answer (and its original timestamp)
//     from the source chain into the PushPriceFeed on the perps chain. Moves under 0.05%
//     are skipped unless the on-chain price is 30+ minutes old.
//  2. Liquidate positions below maintenance margin.
//  3. In the pre-close window, trim positions above the weekend leverage cap.
//  4. Poke markets whose borrow index hasn't moved for 6 hours (keeps weekend fees exact).
//
// Env:
//   PERPS_RPC          perps chain RPC [Elysium mainnet https://rpc.elysium.kinetiq.xyz]
//   PERPS_KEEPER_KEY   key of the feed updater / keeper wallet (required unless DRY_RUN=1)
//   SOURCE_RPC         price source chain RPC [https://rpc.mainnet.chain.robinhood.com]
//   PYTH_API_KEY       Pyth Hermes key, for markets priced by Pyth (skipped without it)
//   DEPLOYMENT         [../contracts/deployments/perps-99901.json]
//   DRY_RUN=1          report only

import fs from "fs";
import { createPublicClient, createWalletClient, http, parseAbi, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = (p) => new URL(p, import.meta.url).pathname;
const DRY = process.env.DRY_RUN === "1";
const dep = JSON.parse(fs.readFileSync(process.env.DEPLOYMENT || here("../contracts/deployments/perps-99901.json"), "utf8"));
const allSources = JSON.parse(fs.readFileSync(here("./perps-sources.json"), "utf8"));
const sources = allSources["4663"];
const pythIds = allSources.pyth || {};
// Feeds deployed for markets the owner hasn't added to the engine yet: keep their prices fresh too.
const pendingPath = here(`../contracts/deployments/perps-feeds-${dep.chainId}.json`);
const pendingFeeds = fs.existsSync(pendingPath) ? JSON.parse(fs.readFileSync(pendingPath, "utf8")) : [];
const PERPS_RPC = process.env.PERPS_RPC || "https://rpc.elysium.kinetiq.xyz";
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

/** Latest Pyth prices (8 decimals) for the given symbols. Needs PYTH_API_KEY. */
async function loadPyth(symbols) {
  const out = {};
  if (!symbols.length) return out;
  if (!process.env.PYTH_API_KEY) { console.log(`  ${symbols.length} Pyth markets skipped: PYTH_API_KEY not set`); return out; }
  const qs = symbols.map((s) => "ids[]=" + pythIds[s]).join("&");
  const res = await fetch("https://hermes.pyth.network/v2/updates/price/latest?parsed=true&" + qs, { headers: { Authorization: "Bearer " + process.env.PYTH_API_KEY } });
  if (!res.ok) { console.log(`  Pyth request failed: HTTP ${res.status}`); process.exitCode = 1; return out; }
  const body = await res.json();
  const byId = Object.fromEntries((body.parsed || []).map((p) => ["0x" + p.id.replace(/^0x/, ""), p.price]));
  for (const s of symbols) {
    const p = byId[pythIds[s]];
    if (!p) continue;
    const price = BigInt(p.price), conf = BigInt(p.conf), expo = Number(p.expo);
    if (price <= 0n || conf * 100n > price * 2n) { console.log(`  ${s}: Pyth price unusable (confidence too wide)`); continue; }
    const answer = expo + 8 >= 0 ? price * 10n ** BigInt(expo + 8) : price / 10n ** BigInt(-(expo + 8));
    out[s] = { answer, updatedAt: BigInt(p.publish_time) };
  }
  return out;
}

async function main() {
  const now = (await pub.getBlock()).timestamp;
  console.log(`perps chain ${dep.chainId}, block time ${new Date(Number(now) * 1000).toISOString()}, ${dep.markets.length} markets`);

  // 1. prices (Chainlink on the source chain, or Pyth Hermes)
  const live = new Set(dep.markets.map((m) => m.symbol));
  const targets = [...dep.markets, ...pendingFeeds.filter((p) => !live.has(p.symbol))];
  const pyth = await loadPyth(targets.filter((m) => !sources[m.symbol] && pythIds[m.symbol]).map((m) => m.symbol));
  for (const m of targets) {
    let answer, updatedAt;
    if (sources[m.symbol]) {
      const r = await src.readContract({ address: sources[m.symbol], abi: FEED, functionName: "latestRoundData" });
      answer = r[1]; updatedAt = r[3];
    } else if (pyth[m.symbol]) {
      ({ answer, updatedAt } = pyth[m.symbol]);
    } else { if (!pythIds[m.symbol]) console.log(`  ${m.symbol}: no price source`); continue; }
    const t = await pub.readContract({ address: m.feed, abi: FEED, functionName: "latestRoundData" });
    if (updatedAt <= t[3]) continue; // already mirrored
    // Save gas: skip moves under 0.05% unless the on-chain price is 30+ minutes old.
    const move = t[1] > 0n ? Number(answer > t[1] ? answer - t[1] : t[1] - answer) / Number(t[1]) : 1;
    if (move < 0.0005 && now - t[3] < 1800n) continue;
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
