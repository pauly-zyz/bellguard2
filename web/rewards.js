// Bellguard $BLGD holder rewards page. Uses viem from jsDelivr.
import {
  createPublicClient, createWalletClient, custom, http, fallback, parseAbi, formatUnits, defineChain, decodeEventLog,
} from "https://cdn.jsdelivr.net/npm/viem@2.21.54/+esm";

const P = window.BELLGUARD_PERPS;
const D = P.deployment;
const RW = P.rewards;
const $ = (id) => document.getElementById(id);
const chain = defineChain({
  id: P.chainId, name: P.chain.name, nativeCurrency: P.chain.nativeCurrency,
  rpcUrls: { default: { http: [P.chain.rpc] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});
const client = createPublicClient({
  chain,
  transport: fallback([http(P.chain.relay, { retryCount: 2, timeout: 15_000 }), http(P.chain.rpc, { retryCount: 2, timeout: 15_000 })]),
  batch: { multicall: { batchSize: 4096, wait: 20 } },
});
const ABI = {
  erc20: parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]),
  dist: parseAbi([
    "function owner() view returns (address)", "function epoch() view returns (uint256)", "function merkleRoot() view returns (bytes32)",
    "function claimed(address) view returns (uint256)", "function claim(address account, uint256 cumulative, bytes32[] proof)",
    "function publish(uint256 epoch, bytes32 root)",
  ]),
  events: parseAbi([
    "event PositionOpened(uint256 indexed id, address indexed owner, uint256 indexed market, bool isLong, uint256 collateral, uint256 size, uint256 price, uint256 fee)",
    "event PositionClosed(uint256 indexed id, uint256 price, int256 pnl, uint256 borrowFee, uint256 closeFee, uint256 paidOut)",
    "event PositionLiquidated(uint256 indexed id, address indexed liquidator, uint256 price, int256 equity, uint256 reward)",
  ]),
};
const usd = (raw) => "$" + Number(formatUnits(raw, 6)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blgd = (raw) => Number(formatUnits(raw, RW.tokenDecimals)).toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtDate = (iso) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
function log(id, msg, err) { const el = $(id); el.textContent = msg; el.style.color = err ? "var(--closed)" : "var(--muted)"; }

let account = null, wallet = null, latest = null, weekFees = null;

/** Current or next configured week. */
function currentWeek() {
  const now = Date.now();
  return RW.weeks.find((w) => now < Date.parse(w.end)) || RW.weeks[RW.weeks.length - 1];
}

/** Fees from Bellguard Perps events in [start, end), per trader (same rules as keeper/rewards.mjs). */
async function loadWeekFees(w) {
  const t0 = Date.parse(w.start) / 1000, t1 = Date.parse(w.end) / 1000;
  const raw = await client.request({ method: "eth_getLogs", params: [{ address: D.engine, fromBlock: "0x0", toBlock: "latest" }] });
  const pos = new Map(), fees = new Map();
  const add = (a, v) => fees.set(a, (fees.get(a) || 0n) + v);
  for (const l of raw) {
    let e; try { e = decodeEventLog({ abi: ABI.events, data: l.data, topics: l.topics }); } catch { continue; }
    const ts = Number(l.blockTimestamp || 0);
    const inWeek = ts >= t0 && ts < t1;
    if (e.eventName === "PositionOpened") { pos.set(e.args.id, { owner: e.args.owner.toLowerCase(), size: e.args.size }); if (inWeek) add(e.args.owner.toLowerCase(), e.args.fee); }
    else if (e.eventName === "PositionClosed" && inWeek) { const p = pos.get(e.args.id); if (p) add(p.owner, e.args.borrowFee + e.args.closeFee); }
    else if (e.eventName === "PositionLiquidated" && inWeek) { const p = pos.get(e.args.id); if (p) add(p.owner, p.size * 8n / 10_000n); }
  }
  const total = [...fees.values()].reduce((a, b) => a + b, 0n);
  return { fees, total, traders: fees.size };
}

function renderWeek() {
  const w = currentWeek();
  const now = Date.now(), started = now >= Date.parse(w.start);
  $("r-weekpill").textContent = "Week " + w.n + (started ? "" : " · starts soon");
  $("r-weekpill").className = "pill " + (started ? "open" : "closed");
  const pool = weekFees ? weekFees.total * BigInt(w.poolShareBps) / 10_000n : null;
  $("r-week").innerHTML = [
    ["Period", fmtDate(w.start) + " → " + fmtDate(w.end)],
    ["Pool", (w.poolShareBps / 100) + "% of trading fees" + (w.n === 1 ? " (launch week)" : "")],
    ["Fees so far", weekFees ? usd(weekFees.total) + " from " + weekFees.traders + " trader" + (weekFees.traders === 1 ? "" : "s") : started ? "Loading…" : "Starts " + fmtDate(w.start)],
    ["Pool so far", pool == null ? "–" : usd(pool) + " USDC"],
    ["Eligibility", "Average balance ≥ " + RW.minHolding.toLocaleString("en-US") + " BLGD over the week"],
  ].map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");
}

async function renderMe() {
  if (!account) return;
  const a = account.toLowerCase();
  const [bal, claimedRaw] = await Promise.all([
    client.readContract({ address: RW.token, abi: ABI.erc20, functionName: "balanceOf", args: [account] }),
    client.readContract({ address: RW.distributor, abi: ABI.dist, functionName: "claimed", args: [account] }),
  ]);
  const min = BigInt(RW.minHolding) * 10n ** BigInt(RW.tokenDecimals);
  const ok = bal >= min;
  const myFees = weekFees ? weekFees.fees.get(a) || 0n : 0n;
  const entry = latest && latest.claims ? Object.entries(latest.claims).find(([k]) => k.toLowerCase() === a) : null;
  const cumulative = entry ? BigInt(entry[1].cumulative) : 0n;
  const claimable = cumulative > claimedRaw ? cumulative - claimedRaw : 0n;
  $("r-me").innerHTML = [
    ["Wallet", account.slice(0, 6) + "…" + account.slice(-4)],
    ["BLGD balance", blgd(bal) + " " + (ok ? "<b class='gain'>✓ eligible size</b>" : "<b class='loss'>needs " + RW.minHolding.toLocaleString("en-US") + "</b>")],
    ["Your fees this week", usd(myFees) + (ok && myFees > 0n ? " <span class='muted'>(comes back to you)</span>" : "")],
    ["Last published week", latest ? "Week " + latest.epoch + (entry ? ": " + usd(BigInt(entry[1].thisWeek)) : ": no reward") : "None yet"],
    ["Claimed so far", usd(claimedRaw)],
  ].map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");
  $("r-claimable").textContent = usd(claimable) + " USDC";
  const btn = $("r-claim");
  btn.disabled = claimable === 0n;
  btn.onclick = () => claim(entry[1]);
}

async function send(logId, label, req) {
  log(logId, label + ": confirm in your wallet…");
  const hash = await wallet.writeContract({ account, chain, ...req });
  log(logId, label + ": waiting for confirmation…");
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(label + " reverted");
}

async function claim(c) {
  try {
    await send("r-clog", "Claim", { address: RW.distributor, abi: ABI.dist, functionName: "claim", args: [account, BigInt(c.cumulative), c.proof] });
    log("r-clog", "Claimed. The USDC is in your wallet.");
    renderMe();
  } catch (e) { log("r-clog", (e.shortMessage || e.message).split("\n")[0], true); }
}

/** Owner: fund the contract for the latest calculated week and publish its root. */
async function renderAdmin() {
  const panel = $("r-admin");
  if (!account) { panel.hidden = true; return; }
  const [owner, onEpoch, held] = await Promise.all([
    client.readContract({ address: RW.distributor, abi: ABI.dist, functionName: "owner" }),
    client.readContract({ address: RW.distributor, abi: ABI.dist, functionName: "epoch" }),
    client.readContract({ address: D.collateral, abi: ABI.erc20, functionName: "balanceOf", args: [RW.distributor] }),
  ]);
  panel.hidden = owner.toLowerCase() !== account.toLowerCase();
  if (panel.hidden) return;
  let need = 0n, ready = latest && latest.root && BigInt(latest.epoch) > onEpoch;
  if (latest && latest.claims) {
    const addrs = Object.keys(latest.claims);
    const claimed = await Promise.all(addrs.map((a) => client.readContract({ address: RW.distributor, abi: ABI.dist, functionName: "claimed", args: [a] })));
    const owed = addrs.reduce((s, a, i) => s + BigInt(latest.claims[a].cumulative) - claimed[i], 0n);
    need = owed > held ? owed - held : 0n;
  }
  $("ra-list").innerHTML = [
    ["Published on-chain", "Week " + onEpoch],
    ["Latest calculated", latest ? "Week " + latest.epoch + " · " + usd(BigInt(latest.epochTotal)) + " to holders (fees " + usd(BigInt(latest.totalFees)) + ")" : "None yet (first file after week 1 ends)"],
    ["USDC in rewards contract", usd(held)],
    ["Still to fund", usd(need)],
  ].map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");
  const btn = $("ra-publish");
  btn.hidden = !ready;
  btn.textContent = "Fund " + usd(need) + " & publish week " + (latest ? latest.epoch : "");
  btn.onclick = async () => {
    try {
      if (need > 0n) await send("ra-log", "Send " + usd(need) + " USDC", { address: D.collateral, abi: ABI.erc20, functionName: "transfer", args: [RW.distributor, need] });
      await send("ra-log", "Publish week " + latest.epoch, { address: RW.distributor, abi: ABI.dist, functionName: "publish", args: [BigInt(latest.epoch), latest.root] });
      log("ra-log", "Week " + latest.epoch + " is live. Holders can claim now.");
      renderAdmin(); renderMe();
    } catch (e) { log("ra-log", (e.shortMessage || e.message).split("\n")[0], true); }
  };
}

// ---------------------------------------------------------------- wallet (EIP-6963)
const wallets = new Map();
window.addEventListener("eip6963:announceProvider", (e) => { const { info, provider } = e.detail || {}; if (info && provider) wallets.set(info.uuid, { info, provider }); });
window.dispatchEvent(new Event("eip6963:requestProvider"));
function chooseWallet() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const list = [...wallets.values()];
  if (window.ethereum && !list.some((w) => w.provider === window.ethereum)) list.push({ info: { uuid: "injected", name: "Browser wallet", icon: "" }, provider: window.ethereum });
  if (list.length <= 1) return Promise.resolve(list[0] ? list[0].provider : null);
  return new Promise((resolve) => {
    const ul = $("wallet-list"); ul.innerHTML = "";
    for (const w of list) {
      const b = document.createElement("button"); b.type = "button"; b.className = "wallet-option";
      if (w.info.icon) { const img = document.createElement("img"); img.src = w.info.icon; img.width = 28; img.height = 28; img.alt = ""; b.appendChild(img); }
      b.appendChild(document.createTextNode(w.info.name));
      b.onclick = () => { $("wallet-picker").hidden = true; resolve(w.provider); };
      ul.appendChild(b);
    }
    $("wallet-cancel").onclick = () => { $("wallet-picker").hidden = true; resolve(null); };
    $("wallet-picker").hidden = false;
  });
}
async function connect() {
  const provider = await chooseWallet();
  if (!provider) { log("r-log", "No browser wallet found.", true); return; }
  try {
    wallet = createWalletClient({ chain, transport: custom(provider) });
    [account] = await wallet.requestAddresses();
    try { await wallet.switchChain({ id: P.chainId }); } catch { await wallet.addChain({ chain }); }
    $("r-connect").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    log("r-log", "");
    await Promise.all([renderMe(), renderAdmin()]);
  } catch (e) { log("r-log", "Wallet connection failed: " + (e.shortMessage || e.message), true); }
}
$("r-connect").addEventListener("click", connect);

(async () => {
  renderWeek();
  try { const r = await fetch("rewards/latest.json", { cache: "no-store" }); if (r.ok) latest = await r.json(); } catch { /* none yet */ }
  try { weekFees = await loadWeekFees(currentWeek()); } catch (e) { log("r-log", "Couldn't load this week's fees (" + (e.shortMessage || e.message).split("\n")[0] + ").", true); }
  renderWeek();
  if (account) renderMe();
})();
