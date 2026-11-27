// Bellguard Perps: long or short stock prices on Elysium. Uses viem from jsDelivr.
import {
  createPublicClient, createWalletClient, custom, http, fallback, parseAbi, formatUnits, parseUnits, defineChain, maxUint256,
  encodeAbiParameters, encodePacked, keccak256,
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
let payWith = "USDC";          // or the swap token (HYPE)
let hypePrice = null;          // USDC per HYPE from the swap pool
let hypeBal = null, usdcBal = null;
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

/** Chainlink price history for the chart: the last HISTORY rounds from the source chain. */
const HISTORY = 600;
async function loadSpark(i) {
  const m = markets[i];
  if (m.spark || m.sparkLoading) { renderSpark(); return; }
  m.sparkLoading = true;
  try {
    let round = m.round;
    if (round == null) round = (await source.readContract({ address: m.sourceFeed, abi: ABI.feed, functionName: "latestRoundData" }))[0];
    const ids = []; for (let k = HISTORY - 1; k >= 0; k--) if (round - BigInt(k) > 0n) ids.push(round - BigInt(k));
    const pts = [];
    for (let j = 0; j < ids.length; j += 150) {
      const r = await source.multicall({ contracts: ids.slice(j, j + 150).map((id) => ({ address: m.sourceFeed, abi: ABI.feed, functionName: "getRoundData", args: [id] })), allowFailure: true });
      for (const x of r) if (x.status === "success" && x.result[1] > 0n && x.result[3] > 0n) pts.push({ t: Number(x.result[3]), p: Number(x.result[1]) / 1e8 });
    }
    pts.sort((x, y) => x.t - y.t);
    m.spark = pts;
  } catch { m.spark = []; }
  m.sparkLoading = false;
  if (i === sel) { renderSpark(true); renderHead(); }
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
  // 24h change from the chart history
  let first = null;
  if (m.spark && m.spark.length) {
    const cut = Date.now() / 1000 - 86400;
    const before = m.spark.filter((x) => x.t <= cut);
    first = (before.length ? before[before.length - 1] : m.spark[0]).p;
  }
  const ch = first && m.price ? (m.price / first - 1) * 100 : null;
  $("t-head").innerHTML = logoHtml(m, "lg")
    + "<div class='who'><span class='tk'>" + esc(m.symbol) + "<span class='muted'> / USD</span></span><span class='nm'>" + esc(m.name) + (m.type ? " · " + m.type : "") + "</span></div>"
    + "<div class='px'><b>" + px(m.price) + "</b><span>" + (ch == null ? "" : "<em class='" + (ch >= 0 ? "gain" : "loss") + "'>" + (ch >= 0 ? "▲ +" : "▼ ") + ch.toFixed(2) + "% 24h</em> · ") + "Chainlink " + ago(m.updated) + "</span></div>";
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

// ---------------------------------------------------------------- chart (TradingView Lightweight Charts)

let chart = null, series = null, seriesType = null;
let chartType = "candle";
let tf = 3600;
let lastBars = [];
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function ensureChart() {
  if (chart || !window.LightweightCharts) return !!chart;
  const host = $("t-chart");
  chart = window.LightweightCharts.createChart(host, {
    autoSize: true,
    layout: { background: { type: "solid", color: "transparent" }, textColor: cssVar("--muted") || "#94a3b8", fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 11 },
    grid: { vertLines: { color: cssVar("--grid") || "rgba(148,163,184,0.06)" }, horzLines: { color: cssVar("--grid") || "rgba(148,163,184,0.06)" } },
    rightPriceScale: { borderColor: cssVar("--rule") || "#22314a", scaleMargins: { top: 0.12, bottom: 0.08 } },
    timeScale: { borderColor: cssVar("--rule") || "#22314a", timeVisible: true, secondsVisible: false, rightOffset: 4 },
    crosshair: { mode: 0 },
    localization: { priceFormatter: (v) => "$" + v.toFixed(v < 10 ? 3 : 2) },
  });
  chart.subscribeCrosshairMove((param) => {
    const d = param && param.time && series ? param.seriesData.get(series) : null;
    showOhlc(d || lastBars[lastBars.length - 1]);
  });
  return true;
}

function showOhlc(d) {
  const el = $("t-ohlc");
  if (!d) { el.textContent = ""; return; }
  if (d.open != null) {
    const up = d.close >= d.open;
    el.innerHTML = ["O", d.open, "H", d.high, "L", d.low, "C", d.close].map((v, i) => i % 2 ? "<b class='" + (up ? "gain" : "loss") + "'>" + v.toFixed(2) + "</b>" : "<span>" + v + "</span>").join(" ");
  } else {
    el.innerHTML = "<span>Price</span> <b>" + d.value.toFixed(2) + "</b>";
  }
}

/** Group price updates into candles of `tf` seconds (only periods with updates, so weekends don't leave gaps). */
function toBars(pts) {
  if (chartType === "line") {
    const out = [];
    for (const x of pts) { const t = Math.floor(x.t / 60) * 60; if (out.length && out[out.length - 1].time === t) out[out.length - 1].value = x.p; else out.push({ time: t, value: x.p }); }
    return out;
  }
  const out = [];
  for (const x of pts) {
    const t = Math.floor(x.t / tf) * tf;
    const c = out[out.length - 1];
    if (c && c.time === t) { c.high = Math.max(c.high, x.p); c.low = Math.min(c.low, x.p); c.close = x.p; }
    else out.push({ time: t, open: c ? c.close : x.p, high: Math.max(x.p, c ? c.close : x.p), low: Math.min(x.p, c ? c.close : x.p), close: x.p });
  }
  return out;
}

/** Keep the order's entry and liquidation prices inside the visible price range. */
function withPreview(original) {
  const r = original();
  if (!r || !r.priceRange || !previewRange) return r;
  return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...previewRange), maxValue: Math.max(r.priceRange.maxValue, ...previewRange) } };
}

function renderSpark(fit) {
  const m = markets[sel];
  const msg = $("t-chart-msg");
  const pts = (m.spark || []).slice();
  if (m.price && m.updated && (!pts.length || m.updated > pts[pts.length - 1].t)) pts.push({ t: m.updated, p: m.price });
  if (pts.length < 2) { msg.hidden = false; msg.textContent = m.sparkLoading ? "Loading chart…" : "No chart data yet"; return; }
  if (!ensureChart()) { msg.hidden = false; msg.textContent = "Chart library didn't load. Refresh to try again."; return; }
  msg.hidden = true;
  const want = chartType === "candle" ? "candle" : "line";
  if (seriesType !== want) {
    if (series) chart.removeSeries(series);
    const gain = cssVar("--chart-gain") || "#4fd29a", loss = cssVar("--chart-loss") || "#ff7d61";
    series = want === "candle"
      ? chart.addCandlestickSeries({ upColor: gain, downColor: loss, borderUpColor: gain, borderDownColor: loss, wickUpColor: gain, wickDownColor: loss, priceLineVisible: true, autoscaleInfoProvider: withPreview })
      : chart.addAreaSeries({ lineColor: cssVar("--brass") || "#e2b052", topColor: "rgba(226,176,82,0.28)", bottomColor: "rgba(226,176,82,0)", lineWidth: 2, priceLineVisible: true, autoscaleInfoProvider: withPreview });
    seriesType = want;
    previewLines = []; // they belonged to the removed series
    fit = true;
  }
  lastBars = toBars(pts);
  series.setData(lastBars);
  if (fit) {
    const n = lastBars.length;
    if (chartType === "candle" && n > 120) chart.timeScale().setVisibleLogicalRange({ from: n - 120, to: n + 3 });
    else chart.timeScale().fitContent();
  }
  showOhlc(lastBars[lastBars.length - 1]);
  drawPreviewLines(orderPlan());
  const from = new Date(pts[0].t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  $("t-chart-foot").textContent = pts.length + " Chainlink price updates since " + from + " · times in your time zone · candles only cover periods with updates";
}

// ---------------------------------------------------------------- pay with HYPE (swap to USDC first)

const SW = P.swap || null;
const POOL_KEY_T = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] };
const swapFee = () => (SW ? SW.poolKey.fee / 1e6 : 0);

/** HYPE price from the pool's current sqrtPrice (Uniswap v4 slot0 via extsload). */
async function loadHypePrice() {
  if (!SW || !D) return;
  try {
    const id = keccak256(encodeAbiParameters([POOL_KEY_T], [SW.poolKey]));
    const slot = keccak256(encodePacked(["bytes32", "uint256"], [id, 6n]));
    const word = await perps.readContract({ address: SW.poolManager, abi: parseAbi(["function extsload(bytes32) view returns (bytes32)"]), functionName: "extsload", args: [slot] });
    const sqrtP = BigInt(word) & ((1n << 160n) - 1n);
    const r = Number(sqrtP) / 2 ** 96;
    hypePrice = r * r * 1e12; // USDC (6 dec) per HYPE (18 dec)
    renderSummary();
  } catch { /* keep last price */ }
}

/** Collateral in USDC that the entered amount buys (after the pool fee; before price impact). */
function collateralUsd() {
  const v = Number($("t-collateral").value || 0);
  if (payWith === "USDC") return v;
  return hypePrice ? v * hypePrice * (1 - swapFee()) : 0;
}

/** Universal Router call: swap exactly `amountIn` native HYPE for at least `minOut` USDC. */
function swapCall(amountIn, minOut) {
  const k = SW.poolKey;
  const swap = encodeAbiParameters([{ type: "tuple", components: [POOL_KEY_T, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }], [[k, true, amountIn, minOut, "0x"]]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [k.currency0, amountIn]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [k.currency1, minOut]);
  // V4_SWAP: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [encodePacked(["uint8", "uint8", "uint8"], [0x06, 0x0c, 0x0f]), [swap, settle, take]]);
  return {
    address: SW.router, value: amountIn, functionName: "execute",
    abi: parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]),
    args: ["0x10", [input], BigInt(Math.floor(Date.now() / 1000) + 600)],
  };
}

function setPay(kind) {
  payWith = kind;
  document.querySelectorAll("#t-pay button").forEach((b) => b.classList.toggle("on", b.dataset.pay === kind));
  $("t-col-label").innerHTML = kind === "USDC" ? "Collateral (" + SYM + ")" : "Pay (" + SW.symbol + ")";
  $("t-collateral").value = kind === "USDC" ? "100" : "2";
  showBalance();
  renderSummary();
}

function showBalance() {
  const el = $("t-bal");
  if (!account) { el.textContent = ""; return; }
  if (payWith === "USDC") el.textContent = usdcBal == null ? "" : "Wallet: " + usd(tok(usdcBal)).replace("$", "") + " " + SYM;
  else el.textContent = hypeBal == null ? "" : "Wallet: " + Number(formatUnits(hypeBal, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 }) + " " + SW.symbol + " (keep ~" + SW.gasReserve + " for gas)";
}

/** Order maths, mirroring PerpEngine.openPosition and closePosition. */
function orderPlan() {
  const m = markets[sel];
  const C = collateralUsd();
  const L = Math.min(Number($("t-lev").value), maxLev());
  const f = params.openFeeBps / 1e4, sp = params.spreadBps / 1e4, cf = params.closeFeeBps / 1e4, mm = params.maintenanceBps / 1e4;
  const dir = isLong ? 1 : -1;
  const size = C * L / (1 + L * f);           // net * L = size, net = C - size * f
  const net = C - size * f;
  const entry = m.price ? m.price * (isLong ? 1 + sp : 1 - sp) : null;
  const maxProfit = net * params.maxProfitBps / 1e4;
  // closing fills at the oracle price minus the spread for longs (plus for shorts)
  const exitAt = (mid) => mid * (isLong ? 1 - sp : 1 + sp);
  const midFor = (exit) => exit / (isLong ? 1 - sp : 1 + sp);
  /** What you'd get back if you closed at oracle price `mid` (borrow fee excluded). */
  const valueAt = (mid) => {
    let pnl = size * dir * (exitAt(mid) - entry) / entry;
    if (pnl > maxProfit) pnl = maxProfit;
    const equity = net + pnl - size * cf;
    return { pnl: equity - C, equity, liquidated: equity < size * mm, capped: pnl >= maxProfit };
  };
  let liq = null, breakEven = null;
  if (entry && size > 0) {
    liq = midFor(entry * (1 + dir * (size * mm + size * cf - net) / size));   // equity = maintenance
    breakEven = midFor(entry * (1 + dir * (C - net + size * cf) / size));    // equity = what you paid
  }
  return {
    m, C, L, size, net, entry, liq, breakEven, valueAt, maxProfit,
    fee: size * f, closeFee: size * cf, borrowDay: size * params.borrowBpsPerDay / 1e4,
    liqDist: liq && m.price ? (liq / m.price - 1) * 100 : null,
  };
}

/** Rows for the preview: same numbers in the side panel and the confirm dialog. */
function previewRows(o) {
  return [
    ["Side", "<b class='" + (isLong ? "gain" : "loss") + "'>" + (isLong ? "Long" : "Short") + " " + o.m.symbol + " " + o.L + "x</b>"],
    ["You pay", payWith === "USDC" ? usd(o.C) + " " + SYM
      : Number($("t-collateral").value || 0) + " " + SW.symbol + " <span class='muted'>≈ " + usd(o.C) + " " + SYM + " after swap</span>"],
    ["Position size", usd(o.size)],
    ["Entry price", px(o.entry)],
    ["Break-even price", px(o.breakEven)],
    ["Liquidation price", o.liq && o.liq > 0 ? px(o.liq) + " <span class='muted'>(" + (o.liqDist >= 0 ? "+" : "") + o.liqDist.toFixed(1) + "%)</span>" : "–"],
    ["Fees", usd(o.fee + o.closeFee) + " <span class='muted'>(open + close)</span>"],
    ["Borrow fee", usd(o.borrowDay) + "/day <span class='muted'>(×" + params.closedBorrowMultiplier + " weekends)</span>"],
    ["Max profit", usd(o.maxProfit)],
  ];
}

function scenarioHtml(o) {
  if (!o.entry || !(o.size > 0)) return "";
  const moves = [-10, -5, 5, 10];
  return "<table><thead><tr><th>Move</th>" + moves.map((x) => "<th>" + (x > 0 ? "+" : "") + x + "%</th>").join("") + "</tr></thead><tbody>"
    + "<tr><td>Price</td>" + moves.map((x) => "<td>" + px(o.m.price * (1 + x / 100)) + "</td>").join("") + "</tr>"
    + "<tr><td>Your PnL</td>" + moves.map((x) => {
      const v = o.valueAt(o.m.price * (1 + x / 100));
      if (v.liquidated) return "<td class='loss'>Liquidated</td>";
      return "<td class='" + (v.pnl >= 0 ? "gain" : "loss") + "'>" + usd(v.pnl, Math.abs(v.pnl) >= 100 ? 0 : 2) + "<small>" + (v.pnl / o.C * 100 >= 0 ? "+" : "") + (v.pnl / o.C * 100).toFixed(1) + "%</small></td>";
    }).join("") + "</tr></tbody></table><p class='t-scen-note'>After open and close fees, before borrow fees. Liquidation at " + params.maintenanceBps / 100 + "% margin left.</p>";
}

// Entry and liquidation lines on the chart for the order being previewed.
let previewLines = [];
let previewRange = null; // prices the chart scale must include (entry, liquidation)
function drawPreviewLines(o) {
  if (!series) return;
  for (const l of previewLines) series.removePriceLine(l);
  previewLines = [];
  previewRange = null;
  if (!o.entry || !(o.size > 0)) return;
  previewRange = [o.entry, o.liq > 0 ? o.liq : o.entry];
  const LS = window.LightweightCharts && window.LightweightCharts.LineStyle;
  previewLines.push(series.createPriceLine({ price: o.entry, color: cssVar("--brass") || "#e2b052", lineWidth: 1, lineStyle: LS ? LS.Dashed : 2, axisLabelVisible: true, title: "Entry" }));
  if (o.liq > 0) previewLines.push(series.createPriceLine({ price: o.liq, color: cssVar("--closed") || "#ff7d61", lineWidth: 1, lineStyle: LS ? LS.Dashed : 2, axisLabelVisible: true, title: "Liq." }));
}

function renderSummary() {
  const lev = $("t-lev");
  lev.max = String(params.maxLeverage);
  const cap = maxLev();
  if (Number(lev.value) > cap) lev.value = String(cap);
  $("t-lev-v").textContent = lev.value + "x" + (cap < params.maxLeverage ? " (max " + cap + "x before the close)" : "");
  const o = orderPlan();
  $("t-sum").innerHTML = previewRows(o).slice(2).map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");
  $("t-scen").innerHTML = scenarioHtml(o);
  const conv = $("t-conv");
  conv.hidden = payWith === "USDC";
  if (payWith !== "USDC") conv.textContent = hypePrice
    ? "≈ " + usd(o.C) + " " + SYM + " collateral · 1 " + SW.symbol + " ≈ " + usd(hypePrice) + " · swapped on Uniswap (" + (swapFee() * 100).toFixed(1) + "% pool fee, max " + SW.slippageBps / 100 + "% slippage)"
    : "Loading " + SW.symbol + " price…";
  drawPreviewLines(o);
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
  renderList(); renderHead(); renderSummary(); renderSpark(true); loadSpark(i);
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

/** Show the preview dialog; the transaction is sent only after Confirm. */
function submit() {
  if (!account) return connect();
  if (!D) return;
  const o = orderPlan();
  if (!(o.C > 0) || !o.entry) { log("t-olog", "Enter a collateral amount.", true); return; }
  const st = marketState();
  const swapNote = payWith === "USDC" ? "" : "<p class='note' style='margin:0 0 8px'><b>Two steps:</b> your wallet first swaps " + Number($("t-collateral").value || 0) + " " + SW.symbol + " to " + SYM + " on Uniswap, then opens the position with the " + SYM + " received. The final size follows the amount the swap returns.</p>";
  $("tc-body").innerHTML = swapNote + "<dl class='kv'>" + previewRows(o).map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("") + "</dl>"
    + "<div class='t-scen'>" + scenarioHtml(o) + "</div>"
    + "<p class='note' style='margin:0'>Fills at the oracle price ± " + params.spreadBps / 100 + "% spread, and won't fill more than 0.5% away from the entry shown." + (st.until && !st.closed ? " Next market close: " + fmtWhen(st.until) + "; trading pauses until reopen." : "") + "</p>";
  const ok = $("tc-ok");
  ok.textContent = "Confirm " + (isLong ? "long " : "short ") + o.m.symbol;
  ok.classList.toggle("short", !isLong);
  $("t-confirm").hidden = false;
  ok.focus();
}

async function openConfirmed() {
  $("t-confirm").hidden = true;
  const o = orderPlan();
  try {
    if (!(o.C > 0) || !o.entry) throw new Error("Enter a collateral amount.");
    let collateral, size;
    if (payWith === "USDC") {
      collateral = parseUnits(String(o.C), 6);
      size = BigInt(Math.floor(o.size * 1e6));
      const bal = await perps.readContract({ address: D.collateral, abi: ABI.erc20, functionName: "balanceOf", args: [account] });
      if (bal < collateral) throw new Error("Not enough " + SYM + " in your wallet." + (D.testToken ? " Use the faucet button below." : ""));
    } else {
      // 1) swap HYPE -> USDC, 2) open with exactly what the swap returned, same leverage
      const amountIn = parseUnits($("t-collateral").value || "0", 18);
      const have = await perps.getBalance({ address: account });
      if (have < amountIn + parseUnits(SW.gasReserve, 18)) throw new Error("Not enough " + SW.symbol + " (keep about " + SW.gasReserve + " " + SW.symbol + " for gas).");
      const minOut = BigInt(Math.floor(o.C * (1 - SW.slippageBps / 1e4) * 1e6));
      const before = await perps.readContract({ address: D.collateral, abi: ABI.erc20, functionName: "balanceOf", args: [account] });
      await send("t-olog", "Swap " + SW.symbol + " to " + SYM, swapCall(amountIn, minOut));
      const after = await perps.readContract({ address: D.collateral, abi: ABI.erc20, functionName: "balanceOf", args: [account] });
      collateral = after - before;
      if (collateral <= 0n) throw new Error("The swap returned no " + SYM + ".");
      const f = params.openFeeBps / 1e4;
      size = BigInt(Math.floor(tok(collateral) * o.L / (1 + o.L * f) * 1e6));
      log("t-olog", "Swapped to " + usd(tok(collateral)) + " " + SYM + ". Opening the position…");
    }
    await ensureAllowance("t-olog", D.engine, collateral);
    // 0.5% slippage bound on the fill
    const acceptable = BigInt(Math.round(o.entry * (isLong ? 1.005 : 0.995) * 1e8));
    await send("t-olog", (isLong ? "Long " : "Short ") + o.m.symbol, { address: D.engine, abi: ABI.engine, functionName: "openPosition", args: [BigInt(o.m.market), isLong, collateral, size, acceptable] });
    log("t-olog", "Position opened: " + (isLong ? "long " : "short ") + o.m.symbol + " " + usd(tok(size)) + ".");
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
    usdcBal = bal;
    hypeBal = await perps.getBalance({ address: account }).catch(() => null);
    showBalance();
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
$("t-type").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  chartType = b.dataset.type;
  document.querySelectorAll("#t-type button").forEach((x) => x.classList.toggle("on", x === b));
  $("t-tf").classList.toggle("dim", chartType === "line");
  renderSpark(true);
});
$("t-tf").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  tf = Number(b.dataset.tf);
  document.querySelectorAll("#t-tf button").forEach((x) => x.classList.toggle("on", x === b));
  if (chartType !== "candle") { chartType = "candle"; document.querySelectorAll("#t-type button").forEach((x) => x.classList.toggle("on", x.dataset.type === "candle")); $("t-tf").classList.remove("dim"); }
  renderSpark(true);
});
// Rebuild the chart with the right colours when the colour scheme changes.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (chart) { chart.remove(); chart = null; series = null; seriesType = null; renderSpark(true); } });
$("t-collateral").addEventListener("input", renderSummary);
$("t-submit").addEventListener("click", submit);
$("t-pay-row").hidden = !(SW && D && !D.testToken);
$("t-pay").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setPay(b.dataset.pay); });
$("tc-ok").addEventListener("click", openConfirmed);
$("tc-cancel").addEventListener("click", () => { $("t-confirm").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("t-confirm").hidden = true; });
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
loadHypePrice();
setInterval(loadHypePrice, 30_000);
setInterval(refreshAccount, 30_000);
setInterval(() => { renderHead(); renderSummary(); }, 15_000);
