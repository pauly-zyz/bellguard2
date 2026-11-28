// Bellguard holder rewards: weekly calculation.
//
//   EPOCH=1 node rewards.mjs        -> web/rewards/epoch-1.json and web/rewards/latest.json
//
// 1. Fees: every PositionOpened (open fee), PositionClosed (borrow + close fee) and
//    PositionLiquidated (close fee on the size) in the week, attributed to the position owner.
// 2. Eligibility: time-weighted average BLGD balance over the week >= minHolding, rebuilt from
//    Transfer logs. Contracts and burn addresses are excluded.
// 3. Pool = poolShareBps of the week's fees. Eligible traders get their own fees back first
//    (pro rata if the pool is smaller); what's left goes to eligible holders by average balance.
// 4. Cumulative amounts (all weeks so far) go into an OpenZeppelin StandardMerkleTree;
//    RewardsDistributor pays the difference to what each wallet already claimed.

import fs from "fs";
import { createPublicClient, http, parseAbi, parseAbiItem, formatUnits, getAddress } from "viem";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const here = (p) => new URL(p, import.meta.url).pathname;
const cfg = JSON.parse(fs.readFileSync(here("./rewards-config.json"), "utf8"));
const dep = JSON.parse(fs.readFileSync(here(`../contracts/deployments/perps-${cfg.chainId}.json`), "utf8"));
const EPOCH = String(process.env.EPOCH || "");
const ep = cfg.epochs[EPOCH];
if (!ep) { console.error(`Epoch ${EPOCH} is not in rewards-config.json`); process.exit(1); }
const RPC = process.env.PERPS_RPC || "https://rpc.elysium.kinetiq.xyz";
const OUT = here("../web/rewards/");
const c = createPublicClient({ transport: http(RPC, { retryCount: 6, retryDelay: 2000 }) });

const t0 = BigInt(Math.floor(Date.parse(ep.start) / 1000));
const t1 = BigInt(Math.floor(Date.parse(ep.end) / 1000));

/** First block with timestamp >= ts (binary search). */
async function blockAt(ts) {
  let lo = 0n, hi = await c.getBlockNumber();
  const head = await c.getBlock({ blockNumber: hi });
  if (head.timestamp < ts) return hi + 1n; // in the future
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const b = await c.getBlock({ blockNumber: mid });
    if (b.timestamp < ts) lo = mid + 1n; else hi = mid;
  }
  return lo;
}

async function main() {
  const now = (await c.getBlock()).timestamp; // chain time
  if (now < t1 && !process.env.PREVIEW) { console.error(`Week ${EPOCH} ends ${ep.end}; run after that (or PREVIEW=1 for a running estimate).`); process.exit(1); }
  const end = now < t1 ? now : t1;
  const [b0, b1] = [await blockAt(t0), (await blockAt(end)) - 1n];
  console.log(`week ${EPOCH}: ${ep.start} -> ${ep.end} (blocks ${b0}..${b1})${now < t1 ? " [preview]" : ""}`);

  // ---- fees by trader
  const ev = {
    opened: parseAbiItem("event PositionOpened(uint256 indexed id, address indexed owner, uint256 indexed market, bool isLong, uint256 collateral, uint256 size, uint256 price, uint256 fee)"),
    closed: parseAbiItem("event PositionClosed(uint256 indexed id, uint256 price, int256 pnl, uint256 borrowFee, uint256 closeFee, uint256 paidOut)"),
    liq: parseAbiItem("event PositionLiquidated(uint256 indexed id, address indexed liquidator, uint256 price, int256 equity, uint256 reward)"),
  };
  const [opened, closed, liq] = await Promise.all([
    c.getLogs({ address: dep.engine, event: ev.opened, fromBlock: 0n, toBlock: b1 }),
    c.getLogs({ address: dep.engine, event: ev.closed, fromBlock: b0, toBlock: b1 }),
    c.getLogs({ address: dep.engine, event: ev.liq, fromBlock: b0, toBlock: b1 }),
  ]);
  const params = await c.readContract({ address: dep.engine, abi: parseAbi(["function getParams() view returns ((uint16 openFeeBps, uint16 closeFeeBps, uint16 spreadBps, uint16 maintenanceBps, uint16 liquidationFeeBps, uint16 deleverageFeeBps, uint32 maxProfitBps, uint32 borrowBpsPerDay, uint16 closedBorrowMultiplier, uint16 maxLeverage, uint16 weekendMaxLeverage, uint32 preCloseWindow, uint16 maxUtilizationBps, uint64 minCollateral))"]), functionName: "getParams" });
  const pos = new Map(opened.map((l) => [l.args.id, { owner: getAddress(l.args.owner), size: l.args.size }]));
  const fees = new Map();
  const add = (owner, v) => fees.set(owner, (fees.get(owner) || 0n) + v);
  for (const l of opened) if (l.blockNumber >= b0) add(getAddress(l.args.owner), l.args.fee);
  for (const l of closed) { const p = pos.get(l.args.id); if (p) add(p.owner, l.args.borrowFee + l.args.closeFee); }
  for (const l of liq) { const p = pos.get(l.args.id); if (p) add(p.owner, p.size * BigInt(params.closeFeeBps) / 10_000n); }
  const totalFees = [...fees.values()].reduce((a, b) => a + b, 0n);

  // ---- time-weighted BLGD balances over [t0, end]
  const transfers = await c.getLogs({ address: cfg.token, event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"), fromBlock: 0n, toBlock: b1 });
  const bal = new Map(), area = new Map(), last = new Map();
  const touch = (a, ts) => {
    const from = last.get(a) ?? t0;
    const span = ts > from ? ts - from : 0n;
    area.set(a, (area.get(a) || 0n) + (bal.get(a) || 0n) * span);
    last.set(a, ts > t0 ? ts : t0);
  };
  for (const l of transfers) {
    const ts = BigInt(l.blockTimestamp ?? (await c.getBlock({ blockNumber: l.blockNumber })).timestamp);
    const tsc = ts < t0 ? t0 : ts;
    const from = getAddress(l.args.from), to = getAddress(l.args.to);
    touch(from, tsc); touch(to, tsc);
    bal.set(from, (bal.get(from) || 0n) - l.args.value);
    bal.set(to, (bal.get(to) || 0n) + l.args.value);
  }
  const span = end - t0;
  const exclude = new Set(cfg.exclude.map((a) => a.toLowerCase()));
  const min = BigInt(cfg.minHolding) * 10n ** BigInt(cfg.tokenDecimals);
  const twab = new Map();
  for (const a of bal.keys()) { touch(a, end); twab.set(a, area.get(a) / span); }
  const candidates = [...twab.entries()].filter(([a, v]) => v >= min && !exclude.has(a.toLowerCase()));
  const codes = await Promise.all(candidates.map(([a]) => c.getCode({ address: a }).catch(() => "0x")));
  // Wallets only: no code, or an EIP-7702 delegation (0xef0100 + address) on an ordinary wallet.
  const isWallet = (code) => !code || code === "0x" || (code.length === 48 && code.toLowerCase().startsWith("0xef0100"));
  const eligible = new Map(candidates.filter((_, i) => isWallet(codes[i])));

  // ---- split the pool
  const pool = totalFees * BigInt(ep.poolShareBps) / 10_000n;
  const rebates = new Map();
  let rebateTotal = 0n;
  for (const [a, f] of fees) if (eligible.has(a)) { rebates.set(a, f); rebateTotal += f; }
  if (rebateTotal > pool) for (const [a, f] of rebates) rebates.set(a, f * pool / rebateTotal);
  const paidRebates = [...rebates.values()].reduce((x, y) => x + y, 0n);
  const leftover = pool - paidRebates;
  const twabTotal = [...eligible.values()].reduce((x, y) => x + y, 0n);
  const share = new Map();
  if (twabTotal > 0n) for (const [a, w] of eligible) share.set(a, leftover * w / twabTotal);

  // ---- cumulative tree
  const prevPath = OUT + `epoch-${Number(EPOCH) - 1}.json`;
  const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, "utf8")) : { claims: {} };
  const accounts = new Set([...Object.keys(prev.claims), ...rebates.keys(), ...share.keys()]);
  const rows = [], claims = {};
  let epochTotal = 0n, cumulativeTotal = 0n;
  for (const a of accounts) {
    const thisWeek = (rebates.get(a) || 0n) + (share.get(a) || 0n);
    const cumulative = BigInt(prev.claims[a]?.cumulative || 0) + thisWeek;
    if (cumulative === 0n) continue;
    epochTotal += thisWeek; cumulativeTotal += cumulative;
    rows.push([a, cumulative.toString()]);
    claims[a] = { cumulative: cumulative.toString(), thisWeek: thisWeek.toString(), feesPaid: (fees.get(a) || 0n).toString(), rebate: (rebates.get(a) || 0n).toString(), holderShare: (share.get(a) || 0n).toString(), avgBalance: (twab.get(a) || 0n).toString() };
  }
  let root = null;
  if (rows.length) {
    const tree = StandardMerkleTree.of(rows, ["address", "uint256"]);
    root = tree.root;
    for (const [i, [a]] of tree.entries()) claims[a].proof = tree.getProof(i);
  }
  const usd = (v) => formatUnits(v, cfg.usdcDecimals);
  const out = {
    epoch: Number(EPOCH), start: ep.start, end: ep.end, preview: now < t1, blocks: [b0.toString(), b1.toString()],
    poolShareBps: ep.poolShareBps, minHolding: cfg.minHolding,
    totalFees: totalFees.toString(), pool: pool.toString(), rebates: paidRebates.toString(), holderShares: leftover.toString(),
    epochTotal: epochTotal.toString(), cumulativeTotal: cumulativeTotal.toString(),
    traders: fees.size, eligibleHolders: eligible.size, root, claims,
  };
  fs.mkdirSync(OUT, { recursive: true });
  const name = now < t1 ? "preview.json" : `epoch-${EPOCH}.json`;
  fs.writeFileSync(OUT + name, JSON.stringify(out, null, 2) + "\n");
  if (now >= t1) fs.writeFileSync(OUT + "latest.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`fees $${usd(totalFees)} from ${fees.size} traders · pool $${usd(pool)} · rebates $${usd(paidRebates)} · holder share $${usd(leftover)} · ${eligible.size} eligible holders · this week $${usd(epochTotal)} · root ${root}`);
  console.log(`wrote web/rewards/${name}`);
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
