// Bellguard settlement keeper.
//
// After every closed window, BellguardClaims.settle(pool, window) must be called between
// reopen + settleDelay and reopen + settleDelay + settleSlot (anyone may call it then; after
// that only the owner can). This script finds windows in that slot and settles every pool
// that traded while the market was closed and isn't settled yet. Pools with no closed-market
// swaps have nothing to settle, so most runs send no transaction.
//
// Env:
//   KEEPER_PRIVATE_KEY  key of a wallet holding a little ETH for gas (required unless DRY_RUN=1)
//   RPC_URL             default https://rpc.mainnet.chain.robinhood.com
//   CHAIN_ID            default 4663
//   DEPLOYMENT          default ../contracts/deployments/<CHAIN_ID>.json
//   POOLS               default ./pools.json
//   DRY_RUN=1           report what would be settled, send nothing

import fs from "fs";
import { createPublicClient, createWalletClient, http, parseAbi, encodeAbiParameters, keccak256, defineChain, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = (p) => new URL(p, import.meta.url).pathname;
const CHAIN_ID = Number(process.env.CHAIN_ID || 4663);
const RPC = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const DRY = process.env.DRY_RUN === "1";
const dep = JSON.parse(fs.readFileSync(process.env.DEPLOYMENT || here(`../contracts/deployments/${CHAIN_ID}.json`), "utf8"));
const pools = JSON.parse(fs.readFileSync(process.env.POOLS || here("./pools.json"), "utf8"))[CHAIN_ID] || [];

const chain = defineChain({ id: CHAIN_ID, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 1500 }) });

const KEY = { type: "tuple", components: [
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] };
const ABI = {
  calendar: parseAbi([
    "function closureCount() view returns (uint256)",
    "function closure(uint256) view returns ((uint64 start, uint64 end))",
  ]),
  hook: parseAbi([
    "function window(bytes32 id, uint256 windowIndex) view returns ((bool started, uint160 sqrtPriceStart, int24 tickStart, int24 minTick, int24 maxTick, uint32 swaps, int256 stockFlowPerL, int256 quoteFlowPerL, uint256 premiumQuote, uint256 premiumStock))",
  ]),
  claims: parseAbi([
    "function settleDelay() view returns (uint256)",
    "function settleSlot() view returns (uint256)",
    "function settlements(bytes32, uint256) view returns (bool settled, uint256 price, int256 markoutPerL)",
    "function settle((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, uint256 windowIndex)",
  ]),
};
const poolId = (key) => keccak256(encodeAbiParameters([KEY], [key]));
const fmt = (ts) => new Date(Number(ts) * 1000).toISOString().replace(".000Z", "Z");

async function main() {
  const now = (await pub.getBlock()).timestamp;
  const [delay, slot, count] = await Promise.all([
    pub.readContract({ address: dep.claims, abi: ABI.claims, functionName: "settleDelay" }),
    pub.readContract({ address: dep.claims, abi: ABI.claims, functionName: "settleSlot" }),
    pub.readContract({ address: dep.calendar, abi: ABI.calendar, functionName: "closureCount" }),
  ]);
  console.log(`chain ${CHAIN_ID}, block time ${fmt(now)}, ${count} published windows, settle slot = reopen + ${delay}s … + ${delay + slot}s`);

  // Windows whose public settle slot is open now (normally zero or one).
  const due = [];
  for (let i = count - 1n; i >= 0n; i--) {
    const w = await pub.readContract({ address: dep.calendar, abi: ABI.calendar, functionName: "closure", args: [i] });
    if (w.end > now) continue; // not reopened yet
    if (w.end + delay + slot <= now) break; // slot passed; older windows too
    if (w.end + delay <= now) due.push({ index: i, ...w });
  }
  if (due.length === 0) { console.log("No window in its settlement slot. Nothing to do."); return; }

  const account = DRY ? null : privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY);
  const wallet = account ? createWalletClient({ account, chain, transport: http(RPC) }) : null;
  if (account) console.log(`keeper ${account.address}, balance ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);

  for (const w of due) {
    console.log(`window #${w.index}: closed ${fmt(w.start)} → reopened ${fmt(w.end)}`);
    for (const p of pools) {
      const id = poolId(p.key);
      const [ws, st] = await Promise.all([
        pub.readContract({ address: dep.hook, abi: ABI.hook, functionName: "window", args: [id, w.index] }),
        pub.readContract({ address: dep.claims, abi: ABI.claims, functionName: "settlements", args: [id, w.index] }),
      ]);
      if (st[0]) { console.log(`  ${p.symbol}: already settled`); continue; }
      if (!ws.started) { console.log(`  ${p.symbol}: no swaps while closed, nothing to settle`); continue; }
      console.log(`  ${p.symbol}: ${ws.swaps} closed-market swaps, settling…`);
      if (DRY) { console.log("    (dry run, not sent)"); continue; }
      try {
        const { request } = await pub.simulateContract({ account, address: dep.claims, abi: ABI.claims, functionName: "settle", args: [p.key, w.index] });
        const hash = await wallet.writeContract(request);
        const r = await pub.waitForTransactionReceipt({ hash });
        console.log(`    ${r.status} ${hash}`);
        if (r.status !== "success") process.exitCode = 1;
      } catch (e) {
        console.log(`    failed: ${(e.shortMessage || e.message).split("\n")[0]}`);
        process.exitCode = 1;
      }
    }
  }
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
