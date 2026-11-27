// Bellguard Perps: long or short stock prices on Elysium testnet. Uses viem from jsDelivr.
import {
  createPublicClient, createWalletClient, custom, http, fallback, parseAbi, formatUnits, parseUnits, defineChain, maxUint256,
} from "https://cdn.jsdelivr.net/npm/viem@2.21.54/+esm";

const P = window.BELLGUARD_PERPS;
const $ = (id) => document.getElementById(id);
const D = P.deployment; // null until deployed: preview mode
const SYM = D && D.testToken ? "tUSD" : (P.collateralSymbol || "USDC");
const WINDOWS = window.BELLGUARD_WINDOWS || [];

// Defaults match contracts/script/DeployPerps.s.sol; replaced by on-chain values once deployed.
let params = { openFeeBps: 8, closeFeeBps: 8, spreadBps: 5, maintenanceBps: 100, maxProfitBps: 90000, borrowBpsPerDay: 3, closedBorrowMultiplier: 3, maxLeverage: 5, weekendMaxLeverage: 3, preCloseWindow: 7200 };

const ABI = {
  feed: parseAbi([
    "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
    "function getRoundData(uint80) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
    "function owner() view returns (address)",
    "function updater() view returns (address)",
    "function setUpdater(address)",
  ]),
  erc20: parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function faucet()",
  ]),
  engine: parseAbi([
    "function nextPositionId() view returns (uint256)",
    "function totalReserved() view returns (uint256)",
    "function inPreCloseWindow() view returns (bool)",
    "function getParams() view returns ((uint16 openFeeBps, uint16 closeFeeBps, uint16 spreadBps, uint16 maintenanceBps, uint16 liquidationFeeBps, uint16 deleverageFeeBps, uint32 maxProfitBps, uint32 borrowBpsPerDay, uint16 closedBorrowMultiplier, uint16 maxLeverage, uint16 weekendMaxLeverage, uint32 preCloseWindow, uint16 maxUtilizationBps, uint64 minCollateral))",
    "function position(uint256) view returns ((address owner, uint32 market, bool isLong, uint256 collateral, uint256 size, uint256 entryPrice, uint256 borrowIndex, uint256 maxProfit, uint64 openedAt))",
    "function positionValue(uint256) view returns (int256 equity, int256 pnl, uint256 borrowFee, uint256 closeFee, bool liquidatable)",
    "function openPosition(uint256 marketId, bool isLong, uint256 collateral, uint256 size, uint256 acceptablePrice) returns (uint256)",
    "function closePosition(uint256 id, uint256 acceptablePrice)",
    "function addCollateral(uint256 id, uint256 amount)",
    "function paused() view returns (bool)",
    "function setPaused(bool)",
  ]),
  owned: parseAbi([
    "function owner() view returns (address)",
    "function pendingOwner() view returns (address)",
    "function acceptOwnership()",
  ]),
  vault: parseAbi([
    "function totalAssets() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function convertToAssets(uint256) view returns (uint256)",
    "function maxWithdraw(address) view returns (uint256)",
    "function deposit(uint256 assets, address receiver) returns (uint256)",
    "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  ]),
};

// ---------------------------------------------------------------- clients

const perpsChain = defineChain({
  id: P.chainId, name: P.chain.name, nativeCurrency: P.chain.nativeCurrency,
  rpcUrls: { default: { http: [P.chain.rpc] } },
  blockExplorers: P.chain.explorer ? { default: { name: "Explorer", url: P.chain.explorer } } : undefined,
});
const transportFor = (relay, rpc) => fallback([
  ...(relay ? [http(relay, { retryCount: 2, retryDelay: 800, timeout: 12_000, batch: true })] : []),
  http(rpc, { retryCount: 2, retryDelay: 1000, timeout: 12_000, batch: true }),
]);
const perps = createPublicClient({ chain: perpsChain, transport: transportFor(P.chain.relay, P.chain.rpc) });
const source = createPublicClient({
  chain: defineChain({ id: P.source.chainId, name: "source", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [P.source.rpc] } }, contracts: { multicall3: { address: P.source.multicall3 } } }),
  transport: transportFor(P.source.relay, P.source.rpc),
});

let account = null;
let wallet = null;
const markets = P.markets.map((m, i) => ({ ...m, market: D ? D.markets.find((x) => x.symbol === m.symbol)?.market ?? i : i, feed: D ? D.markets.find((x) => x.symbol === m.symbol)?.feed : null, price: null, updated: 0, spark: null }));
let sel = 0;
let isLong = true;
let onChainPreClose = null;
let enginePaused = false;

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (v, d = 2) => v == null || !isFinite(v) ? "–" : (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const px = (v) => usd(v, v != null && v < 10 ? 3 : 2);
const tok = (raw) => Number(formatUnits(raw, 6));
function ago(ts) {
  if (!ts) return "";
  const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
  return m < 60 ? m + "m ago" : m < 2880 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago";
}
function log(id, msg, isError) { const el = $(id); el.textContent = msg; el.style.color = isError ? "var(--closed)" : "var(--muted)"; }
function logoHtml(m, cls) {
  return "<span class='logo" + (cls ? " " + cls : "") + "' aria-hidden='true'><span class='ini'>" + esc(m.symbol.slice(0, 4)) + "</span>"
    + (m.logo ? "<img src='" + esc(m.logo) + "' alt='' loading='lazy'>" : "") + "</span>";
}
document.addEventListener("error", (e) => { if (e.target.matches && e.target.matches(".logo img")) e.target.remove(); }, true);

/** Market hours from the published calendar (the same windows the contracts use). */
function marketState(now = Date.now() / 1000) {
  for (const [start, end] of WINDOWS) {
    if (now >= start && now < end) return { closed: true, until: end };
    if (start > now) return { closed: false, until: start, preClose: start - now <= params.preCloseWindow };
  }
  return { closed: false, until: null, preClose: false };
}
const fmtWhen = (ts) => new Date(ts * 1000).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
function maxLev() {
  const st = marketState();
  const pre = onChainPreClose ?? st.preClose;
  return pre ? params.weekendMaxLeverage : params.maxLeverage;
}

// ---------------------------------------------------------------- prices

async function loadPrices() {
  try {
    if (D) {
      const r = await Promise.all(markets.map((m) => perps.readContract({ address: m.feed, abi: ABI.feed, functionName: "latestRoundData" })));
      r.forEach((x, i) => { markets[i].price = Number(x[1]) / 1e8; markets[i].updated = Number(x[3]); });
    } else {
      const r = await source.multicall({ contracts: markets.map((m) => ({ address: m.sourceFeed, abi: ABI.feed, functionName: "latestRoundData" })), allowFailure: true });
      r.forEach((x, i) => { if (x.status === "success") { markets[i].price = Number(x.result[1]) / 1e8; markets[i].updated = Number(x.result[3]); markets[i].round = x.result[0]; } });
    }
    renderList(); renderHead(); renderSummary();
    loadSpark(sel);
  } catch (e) {
    log("t-log", "Couldn't load prices (" + (e.shortMessage || e.message).split("\n")[0] + "). Retrying…", true);
    setTimeout(loadPrices, 10_000);
  }
}

/** Last ~40 Chainlink rounds for the chart, from the source chain. */
async function loadSpark(i) {
  const m = markets[i];
  if (m.spark || m.sparkLoading) { renderSpark(); return; }
  m.sparkLoading = true;
  try {
    let round = m.round;
    if (round == null) round = (await source.readContract({ address: m.sourceFeed, abi: ABI.feed, functionName: "latestRoundData" }))[0];
    const ids = []; for (let k = 39; k >= 0; k--) ids.push(round - BigInt(k));
    const r = await source.multicall({ contracts: ids.map((id) => ({ address: m.sourceFeed, abi: ABI.feed, functionName: "getRoundData", args: [id] })), allowFailure: true });
    m.spark = r.filter((x) => x.status === "success" && x.result[1] > 0n).map((x) => ({ t: Number(x.result[3]), p: Number(x.result[1]) / 1e8 }));
  } catch { m.spark = []; }
  m.sparkLoading = false;
  if (i === sel) { renderSpark(); renderHead(); }
}

// ---------------------------------------------------------------- rendering

function renderList() {
  const q = ($("t-search").value || "").trim().toLowerCase();
  $("t-list").innerHTML = markets.map((m, i) => ({ m, i }))
    .filter(({ m }) => !q || m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    .map(({ m, i }) => "<button type='button' class='t-item' role='option' data-i='" + i + "' aria-selected='" + (i === sel) + "'>"
      + logoHtml(m) + "<span class='tk'>" + esc(m.symbol) + "<small>" + esc(m.name) + "</small></span><span class='px'>" + px(m.price) + "</span></button>").join("");
}

function renderHead() {
  const m = markets[sel];
  const st = marketState();
  const pill = $("t-pill");
  pill.className = "pill " + (st.closed ? "closed" : "open");
  pill.textContent = st.closed ? "Market closed" : "Market open";
  const first = m.spark && m.spark.length ? m.spark[0].p : null;
  const ch = first && m.price ? (m.price / first - 1) * 100 : null;
  $("t-head").innerHTML = logoHtml(m, "lg")
    + "<div class='who'><span class='tk'>" + esc(m.symbol) + "<span class='muted'> / USD</span></span><span class='nm'>" + esc(m.name) + (m.type ? " · " + m.type : "") + "</span></div>"
    + "<div class='px'><b>" + px(m.price) + "</b><span>" + (ch == null ? "" : "<em class='" + (ch >= 0 ? "gain" : "loss") + "'>" + (ch >= 0 ? "▲ +" : "▼ ") + ch.toFixed(2) + "%</em> · ") + "Chainlink " + ago(m.updated) + "</span></div>";
  const rows = [
    st.closed
      ? ["closed", "Trading paused", "The stock market is closed, so prices are frozen. Trading resumes after reopen (" + fmtWhen(st.until) + ") with a fresh price."]
      : (onChainPreClose ?? st.preClose)
        ? ["warn", "Pre-close: max " + params.weekendMaxLeverage + "x", "The market closes " + fmtWhen(st.until) + ". Positions above " + params.weekendMaxLeverage + "x can be trimmed before the bell."]
        : ["ok", "Open: up to " + params.maxLeverage + "x", st.until ? "Next close " + fmtWhen(st.until) + ". Leverage drops to " + params.weekendMaxLeverage + "x in the last " + params.preCloseWindow / 3600 + " hours before it." : "Trading is open."],
    ["ok", "Weekend borrow ×" + params.closedBorrowMultiplier, "Borrow fees run faster while the market is closed. They pay LPs for carrying the Monday gap."],
    ["ok", "Fresh price after reopen", "After a weekend, trading waits for the first price published after the bell."],
  ];
  $("t-bell").innerHTML = "<h3>Bell mode</h3><ul>" + rows.map(([k, t, d]) => "<li class='" + k + "'><b>" + t + "</b><span>" + d + "</span></li>").join("") + "</ul>";
}

function renderSpark() {
  const m = markets[sel];
  const host = $("t-spark");
  const pts = (m.spark || []).slice();
  if (m.price && pts.length && m.updated > pts[pts.length - 1].t) pts.push({ t: m.updated, p: m.price });
  if (pts.length < 2) { host.innerHTML = "<p class='muted' style='margin:auto'>" + (m.sparkLoading ? "Loading chart…" : "No chart data") + "</p>"; return; }
  const W = 640, H = 200, pad = 6;
  const ps = pts.map((x) => x.p), lo = Math.min(...ps), hi = Math.max(...ps), span = hi - lo || hi * 0.01;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const X = (t) => pad + (t - t0) / (t1 - t0 || 1) * (W - 2 * pad);
  const Y = (p) => pad + (1 - (p - lo) / span) * (H - 2 * pad);
  const line = pts.map((x, i) => (i ? "L" : "M") + X(x.t).toFixed(1) + " " + Y(x.p).toFixed(1)).join(" ");
  const up = pts[pts.length - 1].p >= pts[0].p;
  const c = up ? "var(--chart-gain)" : "var(--chart-loss)";
  host.innerHTML = "<svg viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='none'><defs><linearGradient id='sg' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='" + c + "' stop-opacity='0.28'/><stop offset='1' stop-color='" + c + "' stop-opacity='0'/></linearGradient></defs>"
    + "<path d='" + line + " L" + X(t1).toFixed(1) + " " + H + " L" + X(t0).toFixed(1) + " " + H + " Z' fill='url(#sg)'/>"
    + "<path d='" + line + "' fill='none' stroke='" + c + "' stroke-width='2' vector-effect='non-scaling-stroke'/></svg>"
    + "<div class='t-spark-lbl'><span>" + px(hi) + "</span><span>" + px(lo) + "</span></div>"
    + "<div class='t-spark-foot'>Last " + pts.length + " Chainlink updates · " + new Date(t0 * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " – now</div>";
}

/** Order maths, mirroring PerpEngine.openPosition. */
function orderPlan() {
  const m = markets[sel];
  const C = Number($("t-collateral").value || 0);
  const L = Math.min(Number($("t-lev").value), maxLev());
  const f = params.openFeeBps / 1e4, sp = params.spreadBps / 1e4, cf = params.closeFeeBps / 1e4, mm = params.maintenanceBps / 1e4;
  const size = C * L / (1 + L * f);           // net * L = size, net = C - size * f
  const net = C - size * f;
  const entry = m.price ? m.price * (isLong ? 1 + sp : 1 - sp) : null;
  // liquidation when equity = size * mm, at the closing price (with spread)
  let liq = null;
  if (entry && size > 0) {
    const exit = entry * (1 + (isLong ? 1 : -1) * (size * mm + size * cf - net) / size);
    liq = isLong ? exit / (1 - sp) : exit / (1 + sp);
  }
  return { m, C, L, size, net, entry, liq, fee: size * f, borrowDay: size * params.borrowBpsPerDay / 1e4, maxProfit: net * params.maxProfitBps / 1e4 };
}

function renderSummary() {
  const lev = $("t-lev");
  lev.max = String(params.maxLeverage);
  const cap = maxLev();
  if (Number(lev.value) > cap) lev.value = String(cap);
  $("t-lev-v").textContent = lev.value + "x" + (cap < params.maxLeverage ? " (max " + cap + "x before the close)" : "");
  const o = orderPlan();
  $("t-sum").innerHTML = [
    ["Position size", usd(o.size)],
    ["Entry price", px(o.entry)],
    ["Liquidation price", o.liq && o.liq > 0 ? px(o.liq) : "–"],
    ["Open fee", usd(o.fee)],
    ["Borrow fee", usd(o.borrowDay) + " / day"],
    ["Max profit", usd(o.maxProfit)],
  ].map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");
  const st = marketState();
  const btn = $("t-submit");
  btn.classList.toggle("short", !isLong);
  if (!account) { btn.textContent = "Connect wallet"; btn.disabled = false; }
  else if (!D) { btn.textContent = "Trading opens after deployment"; btn.disabled = true; }
  else if (st.closed) { btn.textContent = "Market closed"; btn.disabled = true; }
  else if (enginePaused) { btn.textContent = "Trading paused"; btn.disabled = true; }
  else { btn.textContent = (isLong ? "Long " : "Short ") + o.m.symbol + " " + o.L + "x"; btn.disabled = false; }
}

function select(i) {
  sel = i;
  renderList(); renderHead(); renderSummary(); renderSpark(); loadSpark(i);
}

// ---------------------------------------------------------------- wallet

const wallets = new Map();
window.addEventListener("eip6963:announceProvider", (e) => { const { info, provider } = e.detail || {}; if (info && provider) wallets.set(info.uuid, { info, provider }); });
window.dispatchEvent(new Event("eip6963:requestProvider"));

function chooseWallet() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const list = [...wallets.values()];
  if (window.ethereum && !list.some((w) => w.provider === window.ethereum)) list.push({ info: { uuid: "injected", name: "Browser wallet", icon: "" }, provider: window.ethereum });
  if (list.length <= 1) return Promise.resolve(list[0] ? list[0].provider : null);
  return new Promise((resolve) => {
    const ul = $("wallet-list");
    ul.innerHTML = "";
    for (const w of list) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "wallet-option";
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
  if (!provider) { if (!window.ethereum && wallets.size === 0) log("t-log", "No browser wallet found. Install one (for example MetaMask or Rabby) and reload.", true); return; }
  try {
    wallet = createWalletClient({ chain: perpsChain, transport: custom(provider) });
    [account] = await wallet.requestAddresses();
    try { await wallet.switchChain({ id: P.chainId }); } catch { await wallet.addChain({ chain: perpsChain }); }
    $("t-connect").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    log("t-log", "Connected to " + P.chain.name + ".");
    renderSummary();
    refreshAccount();
  } catch (e) { log("t-log", "Wallet connection failed: " + (e.shortMessage || e.message), true); }
}

async function send(logId, label, req) {
  log(logId, label + ": confirm in your wallet…");
  const hash = await wallet.writeContract({ account, chain: perpsChain, ...req });
  log(logId, label + ": waiting for confirmation…");
  const r = await perps.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(label + " reverted");
  return r;
}

async function ensureAllowance(logId, spender, amount) {
  const a = await perps.readContract({ address: D.collateral, abi: ABI.erc20, functionName: "allowance", args: [account, spender] });
  if (a < amount) await send(logId, "Approve " + SYM, { address: D.collateral, abi: ABI.erc20, functionName: "approve", args: [spender, maxUint256] });
}

// ---------------------------------------------------------------- trading

async function submit() {
  if (!account) return connect();
  if (!D) return;
  const o = orderPlan();
  try {
    if (!(o.C > 0) || !o.entry) throw new Error("Enter a collateral amount.");
    const collateral = parseUnits(String(o.C), 6);
    const size = BigInt(Math.floor(o.size * 1e6));
    const bal = await perps.readContract({ address: D.collateral, abi: ABI.erc20, functionName: "balanceOf", args: [account] });
    if (bal < collateral) throw new Error("Not enough " + SYM + " in your wallet." + (D.testToken ? " Use the faucet button below." : ""));
    await ensureAllowance("t-olog", D.engine, collateral);
    // 0.5% slippage bound on the fill
    const acceptable = BigInt(Math.round(o.entry * (isLong ? 1.005 : 0.995) * 1e8));
    await send("t-olog", (isLong ? "Long " : "Short ") + o.m.symbol, { address: D.engine, abi: ABI.engine, functionName: "openPosition", args: [BigInt(o.m.market), isLong, collateral, size, acceptable] });
    log("t-olog", "Position opened: " + (isLong ? "long " : "short ") + o.m.symbol + " " + usd(o.size) + ".");
    refreshAccount();
  } catch (e) { log("t-olog", (e.shortMessage || e.message).split("\n")[0], true); }
}

async function faucet() {
  try {
    await send("t-olog", "Faucet", { address: D.collateral, abi: ABI.erc20, functionName: "faucet" });
    log("t-olog", "10,000 " + SYM + " added to your wallet.");
    refreshAccount();
  } catch (e) { log("t-olog", (e.shortMessage || e.message).split("\n")[0] + " (one claim per hour)", true); }
}

let positions = [];
async function loadPositions() {
  if (!D || !account) return;
  const next = Number(await perps.readContract({ address: D.engine, abi: ABI.engine, functionName: "nextPositionId" }));
  const ids = []; for (let id = Math.max(1, next - 400); id < next; id++) ids.push(BigInt(id));
  const all = await Promise.all(ids.map((id) => perps.readContract({ address: D.engine, abi: ABI.engine, functionName: "position", args: [id] })));
  const mine = all.map((p, k) => ({ id: ids[k], ...p })).filter((p) => p.size > 0n && p.owner.toLowerCase() === account.toLowerCase());
  const vals = await Promise.all(mine.map((p) => perps.readContract({ address: D.engine, abi: ABI.engine, functionName: "positionValue", args: [p.id] }).catch(() => null)));
  positions = mine.map((p, k) => ({ ...p, v: vals[k] }));
  renderPositions();
}

function renderPositions() {
  const body = $("t-pos");
  $("t-pcount").textContent = positions.length ? positions.length + " open" : "";
  if (!positions.length) { body.innerHTML = "<tr><td colspan='9' class='muted' style='text-align:left'>No open positions.</td></tr>"; return; }
  const sp = params.spreadBps / 1e4, mm = params.maintenanceBps / 1e4, cf = params.closeFeeBps / 1e4;
  body.innerHTML = positions.map((p) => {
    const m = markets.find((x) => x.market === Number(p.market)) || markets[0];
    const size = tok(p.size), col = tok(p.collateral), entry = Number(p.entryPrice) / 1e8;
    const borrow = p.v ? tok(p.v[2]) : 0;
    const exit = entry * (1 + (p.isLong ? 1 : -1) * (size * mm + size * cf + borrow - col) / size);
    const liq = p.isLong ? exit / (1 - sp) : exit / (1 + sp);
    const pnl = p.v ? Number(p.v[1]) / 1e6 - borrow - tok(p.v[3]) : null;
    return "<tr><td style='text-align:left'><span class='t-cell'>" + logoHtml(m) + esc(m.symbol) + "</span></td>"
      + "<td class='" + (p.isLong ? "gain" : "loss") + "'>" + (p.isLong ? "Long" : "Short") + " " + (size / col).toFixed(1) + "x</td>"
      + "<td>" + usd(size) + "</td><td>" + usd(col) + "</td><td>" + px(entry) + "</td><td>" + px(m.price) + "</td>"
      + "<td class='" + (pnl == null ? "" : pnl >= 0 ? "gain" : "loss") + "'>" + (pnl == null ? "paused" : usd(pnl) + " (" + (pnl / col * 100).toFixed(1) + "%)") + "</td>"
      + "<td>" + px(liq > 0 ? liq : null) + "</td>"
      + "<td><button class='copy' data-close='" + p.id + "'>Close</button> <button class='copy' data-add='" + p.id + "'>Add</button></td></tr>";
  }).join("");
}

async function closePos(id) {
  const p = positions.find((x) => String(x.id) === String(id));
  try {
    const m = markets.find((x) => x.market === Number(p.market));
    const acceptable = m && m.price ? BigInt(Math.round(m.price * (p.isLong ? 0.99 : 1.01) * 1e8)) : 0n;
    await send("t-olog", "Close #" + id, { address: D.engine, abi: ABI.engine, functionName: "closePosition", args: [BigInt(id), acceptable] });
    log("t-olog", "Position #" + id + " closed.");
    refreshAccount();
  } catch (e) { log("t-olog", (e.shortMessage || e.message).split("\n")[0], true); }
}

async function addCol(id) {
  const v = prompt("Add how much " + SYM + " to position #" + id + "?", "50");
  if (!v) return;
  try {
    const amt = parseUnits(v, 6);
    await ensureAllowance("t-olog", D.engine, amt);
    await send("t-olog", "Add collateral", { address: D.engine, abi: ABI.engine, functionName: "addCollateral", args: [BigInt(id), amt] });
    refreshAccount();
  } catch (e) { log("t-olog", (e.shortMessage || e.message).split("\n")[0], true); }
}

// ---------------------------------------------------------------- vault

async function loadVault() {
  if (!D) return;
  const [assets, reserved] = await Promise.all([
    perps.readContract({ address: D.vault, abi: ABI.vault, functionName: "totalAssets" }),
    perps.readContract({ address: D.engine, abi: ABI.engine, functionName: "totalReserved" }),
  ]);
  $("tl-assets").textContent = usd(tok(assets)) + " " + SYM;
  $("tl-reserved").textContent = usd(tok(reserved)) + " (" + (assets > 0n ? (Number(reserved) / Number(assets) * 100).toFixed(1) : "0") + "%)";
  if (account) {
    const [shares, maxW, bal] = await Promise.all([
      perps.readContract({ address: D.vault, abi: ABI.vault, functionName: "balanceOf", args: [account] }),
      perps.readContract({ address: D.vault, abi: ABI.vault, functionName: "maxWithdraw", args: [account] }),
      perps.readContract({ address: D.collateral, abi: ABI.erc20, functionName: "balanceOf", args: [account] }),
    ]);
    const value = await perps.readContract({ address: D.vault, abi: ABI.vault, functionName: "convertToAssets", args: [shares] });
    $("tl-mine").textContent = usd(tok(value)) + " (withdrawable " + usd(tok(maxW)) + ")";
    $("t-bal").textContent = "Wallet: " + usd(tok(bal)).replace("$", "") + " " + SYM;
  }
}

async function vaultAction(dep) {
  try {
    const amt = parseUnits($("tl-amt").value || "0", 6);
    if (amt <= 0n) throw new Error("Enter an amount.");
    if (dep) {
      await ensureAllowance("tl-log", D.vault, amt);
      await send("tl-log", "Deposit", { address: D.vault, abi: ABI.vault, functionName: "deposit", args: [amt, account] });
    } else {
      await send("tl-log", "Withdraw", { address: D.vault, abi: ABI.vault, functionName: "withdraw", args: [amt, account, account] });
    }
    log("tl-log", dep ? "Deposited." : "Withdrawn.");
    refreshAccount();
  } catch (e) { log("tl-log", (e.shortMessage || e.message).split("\n")[0], true); }
}

// ---------------------------------------------------------------- admin (owner wallet only)

const OWNED = () => [["calendar", "Market calendar"], ["vault", "Liquidity vault"], ["engine", "Perps engine"]];
async function loadAdmin() {
  const panel = $("t-admin");
  if (!D || !account) { panel.hidden = true; return; }
  const rows = await Promise.all(OWNED().map(async ([k, label]) => {
    const [o, p] = await Promise.all([
      perps.readContract({ address: D[k], abi: ABI.owned, functionName: "owner" }),
      perps.readContract({ address: D[k], abi: ABI.owned, functionName: "pendingOwner" }),
    ]);
    return { k, label, owner: o.toLowerCase(), pending: p.toLowerCase() };
  }));
  const me = account.toLowerCase();
  const relevant = rows.some((r) => r.owner === me || r.pending === me);
  panel.hidden = !relevant;
  if (!relevant) return;
  $("ta-list").innerHTML = rows.map((r) => "<dt>" + r.label + "</dt><dd>" + (r.owner === me ? "You own it" : r.pending === me ? "Waiting for you to accept" : "Owned by " + r.owner.slice(0, 8) + "…") + "</dd>").join("")
    + "<dt>Trading</dt><dd>" + (enginePaused ? "Paused" : "Running") + "</dd>";
  const pending = rows.filter((r) => r.pending === me);
  $("ta-accept").hidden = pending.length === 0;
  $("ta-accept").dataset.keys = pending.map((r) => r.k).join(",");
  const ownsEngine = rows.find((r) => r.k === "engine").owner === me;
  $("ta-pause").hidden = !ownsEngine;
  $("ta-pause").textContent = enginePaused ? "Resume trading" : "Pause trading";
  // Feeds are owned by the owner wallet from deployment.
  const [feedOwner, updater] = await Promise.all([
    perps.readContract({ address: markets[0].feed, abi: ABI.feed, functionName: "owner" }),
    perps.readContract({ address: markets[0].feed, abi: ABI.feed, functionName: "updater" }),
  ]);
  $("ta-updater-row").hidden = feedOwner.toLowerCase() !== me;
  $("ta-list").innerHTML += "<dt>Price updater</dt><dd>" + updater + "</dd>";
}

async function setUpdater() {
  const to = ($("ta-updater").value || "").trim();
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error("Enter a wallet address (0x… 42 characters).");
    for (let i = 0; i < markets.length; i++) {
      const cur = await perps.readContract({ address: markets[i].feed, abi: ABI.feed, functionName: "updater" });
      if (cur.toLowerCase() === to.toLowerCase()) continue;
      await send("ta-log", "Set updater " + markets[i].symbol + " (" + (i + 1) + " of " + markets.length + ")", { address: markets[i].feed, abi: ABI.feed, functionName: "setUpdater", args: [to] });
    }
    log("ta-log", "All feeds now accept prices from " + to + ".");
    refreshAccount();
  } catch (e) { log("ta-log", (e.shortMessage || e.message).split("\n")[0], true); }
}

async function acceptAll() {
  const keys = ($("ta-accept").dataset.keys || "").split(",").filter(Boolean);
  try {
    for (const k of keys) await send("ta-log", "Accept " + k, { address: D[k], abi: ABI.owned, functionName: "acceptOwnership" });
    log("ta-log", "Done. You own " + keys.length + " contract" + (keys.length === 1 ? "" : "s") + ".");
    refreshAccount();
  } catch (e) { log("ta-log", (e.shortMessage || e.message).split("\n")[0], true); }
}

async function togglePause() {
  try {
    await send("ta-log", enginePaused ? "Resume trading" : "Pause trading", { address: D.engine, abi: ABI.engine, functionName: "setPaused", args: [!enginePaused] });
    log("ta-log", "Trading " + (enginePaused ? "resumed." : "paused."));
    refreshAccount();
  } catch (e) { log("ta-log", (e.shortMessage || e.message).split("\n")[0], true); }
}

async function refreshAccount() {
  if (!D) return;
  try {
    const [p, pre] = await Promise.all([
      perps.readContract({ address: D.engine, abi: ABI.engine, functionName: "getParams" }),
      perps.readContract({ address: D.engine, abi: ABI.engine, functionName: "inPreCloseWindow" }),
    ]);
    params = { ...params, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Number(v)])) };
    onChainPreClose = pre;
    enginePaused = await perps.readContract({ address: D.engine, abi: ABI.engine, functionName: "paused" }).catch(() => false);
    await Promise.all([loadVault(), loadPositions(), loadAdmin()]);
    renderSummary(); renderHead();
  } catch (e) { log("t-log", "Couldn't read the perps contracts (" + (e.shortMessage || e.message).split("\n")[0] + ").", true); }
}

// ---------------------------------------------------------------- wiring

$("t-preview").hidden = !!D;
$("t-live").hidden = !D;
$("t-faucet").hidden = !(D && D.testToken);
document.querySelectorAll("[data-sym]").forEach((e) => { e.textContent = SYM; });
document.querySelectorAll("[data-perps]").forEach((b) => { b.disabled = !D; });
$("t-list").addEventListener("click", (e) => { const b = e.target.closest(".t-item"); if (b) select(Number(b.dataset.i)); });
$("t-search").addEventListener("input", renderList);
$("t-long").addEventListener("click", () => { isLong = true; $("t-long").classList.add("on"); $("t-short").classList.remove("on"); renderSummary(); });
$("t-short").addEventListener("click", () => { isLong = false; $("t-short").classList.add("on"); $("t-long").classList.remove("on"); renderSummary(); });
$("t-lev").addEventListener("input", renderSummary);
$("t-collateral").addEventListener("input", renderSummary);
$("t-submit").addEventListener("click", submit);
$("t-connect").addEventListener("click", connect);
$("t-faucet").addEventListener("click", faucet);
$("tl-dep").addEventListener("click", () => vaultAction(true));
$("ta-accept").addEventListener("click", acceptAll);
$("ta-pause").addEventListener("click", togglePause);
$("ta-set-updater").addEventListener("click", setUpdater);
$("tl-wd").addEventListener("click", () => vaultAction(false));
$("t-pos").addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]"); if (c) return closePos(c.dataset.close);
  const a = e.target.closest("[data-add]"); if (a) return addCol(a.dataset.add);
});

// Links from the home page: trade.html?m=TSLA&side=short
{
  const q = new URLSearchParams(location.search);
  const i = markets.findIndex((m) => m.symbol === (q.get("m") || "").toUpperCase());
  if (i >= 0) sel = i;
  if (q.get("side") === "short") { isLong = false; $("t-short").classList.add("on"); $("t-long").classList.remove("on"); }
}
renderList(); renderHead(); renderSummary(); renderSpark();
loadPrices();
refreshAccount();
setInterval(loadPrices, 60_000);
setInterval(refreshAccount, 30_000);
setInterval(() => { renderHead(); renderSummary(); }, 15_000);
