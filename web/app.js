// Bellguard app: wallet, vault, claims and settlement. Uses viem from jsDelivr.
import {
  createPublicClient, createWalletClient, custom, http, fallback, parseAbi, formatUnits, parseUnits, defineChain,
  encodeAbiParameters, keccak256, parseEventLogs,
} from "https://cdn.jsdelivr.net/npm/viem@2.21.54/+esm";

const CFG = window.BELLGUARD_CONFIG;
const $ = (id) => document.getElementById(id);

const ABI = {
  erc20: parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function decimals() view returns (uint8)",
  ]),
  vault: parseAbi([
    "function totalAssets() view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function convertToAssets(uint256) view returns (uint256)",
    "function maxWithdraw(address) view returns (uint256)",
    "function isLocked() view returns (bool)",
    "function deposit(uint256 assets, address receiver) returns (uint256)",
    "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  ]),
  calendar: parseAbi([
    "function isClosedNow() view returns (bool)",
    "function closureCount() view returns (uint256)",
    "function closureAt(uint256) view returns (bool closed, uint256 index, (uint64 start, uint64 end) w)",
  ]),
  hook: parseAbi([
    "function currentSurchargeBps((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key) view returns (uint256)",
  ]),
  permit2: parseAbi([
    "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
    "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  ]),
  stateView: parseAbi([
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
    "function getLiquidity(bytes32 poolId) view returns (uint128)",
  ]),
  posm: parseAbi([
    "function modifyLiquidities(bytes unlockData, uint256 deadline) payable",
    "event Transfer(address indexed from, address indexed to, uint256 indexed id)",
  ]),
  feed: parseAbi([
    "function latestRoundData() view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80)",
  ]),
  owned: parseAbi([
    "function owner() view returns (address)",
    "function pendingOwner() view returns (address)",
    "function acceptOwnership()",
  ]),
  claims: parseAbi([
    "function settle((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, uint256 windowIndex)",
    "function quoteClaim((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, uint256 windowIndex, (address owner,int24 tickLower,int24 tickUpper,bytes32 salt) p) view returns (uint256)",
    "function registerClaim((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, uint256 windowIndex, (address owner,int24 tickLower,int24 tickUpper,bytes32 salt) p) returns (bytes32 claimId, uint256 amount)",
    "function payClaim(bytes32 claimId) returns (uint256)",
    "function claimDeadline(uint256 windowIndex) view returns (uint256)",
    "event ClaimRegistered(bytes32 indexed claimId, bytes32 indexed id, uint256 indexed windowIndex, address recipient, uint256 amount)",
  ]),
};

let chainId = CFG.defaultChainId;
let account = null;
let wallet = null;

const chainFor = (id) => defineChain({
  id, name: CFG.chains[id].name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [CFG.chains[id].rpc] } },
  contracts: CFG.chains[id].multicall3 ? { multicall3: { address: CFG.chains[id].multicall3 } } : undefined,
});
const dep = () => CFG.chains[chainId] && CFG.chains[chainId].deployment;
// A deployment lists several pools (`pools`); the demo config has a single `pool`.
const poolKey = () => {
  const d = dep();
  if (!d) return null;
  if (!d.pools) return d.pool;
  const i = Math.max(0, $("pool-select").selectedIndex);
  return d.pools[i].key;
};
// The public RPC rate-limits hard, so: one multicall per refresh where available, and
// patient retries. Clients are cached per chain.
const clients = {};
const client = () => {
  if (clients[chainId]) return clients[chainId];
  const cfg = CFG.chains[chainId];
  // Prefer the site's own relay (/api/rpc): it works even where the chain's RPC host is blocked.
  const transports = [];
  if (cfg.relay) transports.push(http(cfg.relay, { retryCount: 2, retryDelay: 800, timeout: 12_000 }));
  transports.push(http(cfg.rpc, { retryCount: 2, retryDelay: 1000, timeout: 12_000 }));
  clients[chainId] = createPublicClient({
    chain: chainFor(chainId),
    transport: transports.length > 1 ? fallback(transports) : transports[0],
  });
  return clients[chainId];
};

/** Read several contract values in one round trip (multicall3) or, without it, one by one. */
async function readMany(calls) {
  const c = client();
  if (CFG.chains[chainId].multicall3) {
    return c.multicall({ contracts: calls, allowFailure: false });
  }
  const out = [];
  for (const call of calls) out.push(await c.readContract(call));
  return out;
}

let retryTimer = null;
function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(refresh, 10_000);
}
const usd = (v) => "$" + Number(formatUnits(v, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 });

function log(id, msg, isError) {
  const el = $(id);
  el.textContent = msg;
  el.style.color = isError ? "var(--closed)" : "var(--muted)";
}

function setDeployedUi() {
  const d = dep();
  $("network-name").textContent = CFG.chains[chainId].name;
  $("not-deployed").hidden = !!d;
  $("liquidity").hidden = !(d && d.positionManager);
  const sel = $("pool-select");
  const pools = d && d.pools ? d.pools : [];
  if (sel.dataset.chain !== String(chainId)) {
    sel.innerHTML = pools.map((p) => "<option>" + p.symbol + " / USDG</option>").join("") || "<option>Example pool</option>";
    sel.dataset.chain = String(chainId);
  }
  document.querySelectorAll("[data-needs-deploy]").forEach((b) => { b.disabled = !d || !account; });
  document.querySelectorAll(".example-tag").forEach((t) => { t.hidden = !!d; });
}

async function refresh() {
  setDeployedUi();
  const d = dep();
  const local = window.bellguardMarketState(Date.now() / 1000);
  if (!d) {
    // Example figures so the panels show what they will contain.
    $("m-state").textContent = local.closed ? "Closed" : "Open";
    $("m-surcharge").textContent = local.closed ? "0.10%" : "0.00%";
    $("v-assets").textContent = "$1,000,000";
    $("v-price").textContent = "1.0042 USDG";
    $("v-locked").textContent = local.closed ? "Locked (market closed)" : "Unlocked";
    $("v-mine").textContent = "–";
    return;
  }
  const fields = ["m-state", "m-surcharge", "v-assets", "v-price", "v-locked"];
  for (const id of fields) if ($(id).textContent === "–") $(id).textContent = "Loading…";
  try {
    const reads = [
      { address: d.calendar, abi: ABI.calendar, functionName: "isClosedNow" },
      { address: d.hook, abi: ABI.hook, functionName: "currentSurchargeBps", args: [poolKey()] },
      { address: d.vault, abi: ABI.vault, functionName: "totalAssets" },
      { address: d.vault, abi: ABI.vault, functionName: "totalSupply" },
      { address: d.vault, abi: ABI.vault, functionName: "isLocked" },
    ];
    if (account) {
      reads.push(
        { address: d.vault, abi: ABI.vault, functionName: "balanceOf", args: [account] },
        { address: d.vault, abi: ABI.vault, functionName: "maxWithdraw", args: [account] },
      );
    }
    const [closed, surcharge, assets, supply, locked, shares, maxW] = await readMany(reads);
    $("m-state").textContent = closed ? "Closed" : "Open";
    $("m-surcharge").textContent = (Number(surcharge) / 100).toFixed(2) + "%";
    $("v-assets").textContent = usd(assets);
    $("v-price").textContent = supply > 0n
      ? (Number(assets) / Number(supply) * 1e6).toFixed(4) + " USDG" // shares carry 6 extra decimals
      : "1.0000 USDG";
    $("v-locked").textContent = locked ? "Locked (closed or claims open)" : "Unlocked";
    if (account) {
      const value = supply > 0n ? shares * assets / supply : 0n;
      $("v-mine").textContent = usd(value) + " (withdrawable now " + usd(maxW) + ")";
    }
    if ($("v-log").dataset.readError) { log("v-log", ""); delete $("v-log").dataset.readError; }
  } catch (e) {
    for (const id of fields) if ($(id).textContent === "Loading…") $(id).textContent = "Unavailable";
    $("v-log").dataset.readError = "1";
    log("v-log", "Couldn't reach Robinhood Chain (" + (e.shortMessage || e.message).split("\n")[0] + "). Retrying in 10 seconds…", true);
    scheduleRetry();
  }
}

// ---------------------------------------------------------------- liquidity

const POOL_KEY_TYPE = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
  ],
};
const MAX_TICK = 887272;
const poolIdOf = (key) => keccak256(encodeAbiParameters([POOL_KEY_TYPE], [key]));
const currentPool = () => { const d = dep(); return d && d.pools ? d.pools[Math.max(0, $("pool-select").selectedIndex)] : null; };
let lpPlan = null;

/** Read pool state and turn the USDG amount + range into a mint plan (liquidity, token caps). */
async function planLiquidity() {
  const d = dep();
  const pool = currentPool();
  lpPlan = null;
  if (!d || !pool || !d.positionManager) return;
  const key = pool.key;
  const usdgIs0 = key.currency0.toLowerCase() === d.usdg.toLowerCase();
  const [slot0, feed] = await readMany([
    { address: d.stateView, abi: ABI.stateView, functionName: "getSlot0", args: [poolIdOf(key)] },
    { address: pool.feed, abi: ABI.feed, functionName: "latestRoundData" },
  ]);
  const [sqrtPriceX96, tick] = slot0;
  const sp = Number(sqrtPriceX96) / 2 ** 96;
  // pool price: USDG per stock (USDG 6 dec, stock 18 dec)
  const raw = sp * sp; // token1 per token0, raw units
  const poolPrice = usdgIs0 ? 1e12 / raw : raw * 1e12;
  const feedPrice = Number(feed[1]) / 1e8;
  $("lp-price").textContent = "$" + poolPrice.toFixed(2) + " in the pool · $" + feedPrice.toFixed(2) + " on Chainlink";
  const gap = Math.abs(poolPrice / feedPrice - 1);
  $("lp-warn").hidden = gap < 0.02;
  $("lp-warn").textContent = "The pool price is " + (gap * 100).toFixed(1) + "% away from Chainlink. Arbitrage will move it once there is liquidity, so your position may be rebalanced right after you add it.";

  const width = $("lp-range").value;
  const sp60 = key.tickSpacing;
  let tl, tu;
  if (width === "full") {
    tl = -Math.floor(MAX_TICK / sp60) * sp60; tu = -tl;
  } else {
    const delta = Math.log(1 + Number(width)) / Math.log(1.0001);
    tl = Math.floor((tick - delta) / sp60) * sp60;
    tu = Math.ceil((tick + delta) / sp60) * sp60;
  }
  const sa = Math.pow(1.0001, tl / 2), sb = Math.pow(1.0001, tu / 2);
  const usdgRaw = parseUnits($("lp-usdg").value || "0", 6);
  if (usdgRaw <= 0n) { $("lp-need").textContent = "–"; return; }
  // Liquidity from the USDG side, then the stock amount that goes with it.
  let L, stockRaw;
  if (usdgIs0) {
    L = Number(usdgRaw) / (1 / sp - 1 / sb);
    stockRaw = L * (sp - sa);
  } else {
    L = Number(usdgRaw) / (sp - sa);
    stockRaw = L * (1 / sp - 1 / sb);
  }
  const liquidity = BigInt(Math.floor(L * 0.999));
  const stockMax = BigInt(Math.ceil(stockRaw * 1.01));
  $("lp-need").textContent = Number(formatUnits(stockMax, 18)).toLocaleString("en-US", { maximumFractionDigits: 6 }) + " " + pool.symbol
    + " (range $" + (usdgIs0 ? 1e12 / Math.pow(1.0001, tu) : Math.pow(1.0001, tl) * 1e12).toFixed(2)
    + " – $" + (usdgIs0 ? 1e12 / Math.pow(1.0001, tl) : Math.pow(1.0001, tu) * 1e12).toFixed(2) + ")";
  lpPlan = {
    key, tl, tu, liquidity,
    amount0Max: usdgIs0 ? usdgRaw : stockMax,
    amount1Max: usdgIs0 ? stockMax : usdgRaw,
    stock: pool.stock, symbol: pool.symbol,
  };
}

async function ensurePermit2(token, amount) {
  const d = dep();
  const c = client();
  const erc = await c.readContract({ address: token, abi: ABI.erc20, functionName: "allowance", args: [account, d.permit2] });
  if (erc < amount) {
    await send("lp-log", "Approve token for Permit2", { address: token, abi: ABI.erc20, functionName: "approve", args: [d.permit2, amount] });
  }
  const [amt, exp] = await c.readContract({ address: d.permit2, abi: ABI.permit2, functionName: "allowance", args: [account, token, d.positionManager] });
  if (amt < amount || exp < Math.floor(Date.now() / 1000) + 600) {
    const expiry = Math.floor(Date.now() / 1000) + 30 * 86400;
    await send("lp-log", "Allow the position manager to use it", { address: d.permit2, abi: ABI.permit2, functionName: "approve", args: [token, d.positionManager, amount, expiry] });
  }
}

async function addLiquidity() {
  const d = dep();
  try {
    await planLiquidity();
    if (!lpPlan) throw new Error("Enter a USDG amount first.");
    const p = lpPlan;
    const [bal0, bal1] = await readMany([
      { address: p.key.currency0, abi: ABI.erc20, functionName: "balanceOf", args: [account] },
      { address: p.key.currency1, abi: ABI.erc20, functionName: "balanceOf", args: [account] },
    ]);
    if (bal0 < p.amount0Max || bal1 < p.amount1Max) throw new Error("Your wallet doesn't hold enough USDG or " + p.symbol + " for this amount.");
    await ensurePermit2(p.key.currency0, p.amount0Max);
    await ensurePermit2(p.key.currency1, p.amount1Max);
    const mint = encodeAbiParameters(
      [POOL_KEY_TYPE, { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "address" }, { type: "bytes" }],
      [p.key, p.tl, p.tu, p.liquidity, p.amount0Max, p.amount1Max, account, "0x"],
    );
    const settle = encodeAbiParameters([{ type: "address" }, { type: "address" }], [p.key.currency0, p.key.currency1]);
    const unlockData = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x020d", [mint, settle]]);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const receipt = await send("lp-log", "Add liquidity", { address: d.positionManager, abi: ABI.posm, functionName: "modifyLiquidities", args: [unlockData, deadline] });
    const minted = parseEventLogs({ abi: ABI.posm, logs: receipt.logs, eventName: "Transfer" })
      .find((l) => l.address.toLowerCase() === d.positionManager.toLowerCase() && BigInt(l.args.from) === 0n);
    const tokenId = minted ? minted.args.id.toString() : "?";
    savePosition({ chainId, symbol: p.symbol, tokenId, tickLower: p.tl, tickUpper: p.tu });
    log("lp-log", "Position #" + tokenId + " added. It is covered from the next closed window, as long as you don't change it.");
    renderPositions();
  } catch (e) { log("lp-log", e.shortMessage || e.message, true); }
}

function loadPositions() {
  try { return JSON.parse(localStorage.getItem("bellguard.positions") || "[]"); } catch { return []; }
}
function savePosition(pos) {
  const list = loadPositions().filter((x) => !(x.chainId === pos.chainId && x.tokenId === pos.tokenId));
  list.push(pos);
  try { localStorage.setItem("bellguard.positions", JSON.stringify(list)); } catch { /* storage unavailable */ }
}
function renderPositions() {
  const d = dep();
  const list = loadPositions().filter((x) => x.chainId === chainId);
  const ul = $("lp-positions");
  ul.innerHTML = "";
  $("lp-positions-wrap").hidden = list.length === 0;
  for (const pos of list) {
    const li = document.createElement("li");
    li.textContent = pos.symbol + " / USDG · NFT #" + pos.tokenId + " · ticks " + pos.tickLower + " to " + pos.tickUpper + " ";
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn ghost"; b.textContent = "Use for claim";
    b.addEventListener("click", () => {
      const pools = d && d.pools ? d.pools : [];
      const i = pools.findIndex((p) => p.symbol === pos.symbol);
      if (i >= 0) $("pool-select").selectedIndex = i;
      $("c-owner").value = d.positionManager; $("c-salt").value = pos.tokenId;
      $("c-lower").value = pos.tickLower; $("c-upper").value = pos.tickUpper;
      $("c-window").focus();
    });
    li.appendChild(b);
    ul.appendChild(li);
  }
}

const ADMIN_CONTRACTS = [["calendar", "Market calendar"], ["vault", "Cover vault"], ["hook", "Bellguard hook"], ["claims", "Claims"]];

async function refreshAdmin() {
  const d = dep();
  const panel = $("admin");
  if (!d || !account) { panel.hidden = true; return; }
  const values = await readMany(ADMIN_CONTRACTS.flatMap(([k]) => [
    { address: d[k], abi: ABI.owned, functionName: "owner" },
    { address: d[k], abi: ABI.owned, functionName: "pendingOwner" },
  ]));
  const rows = ADMIN_CONTRACTS.map(([k, label], i) => ({ k, label, owner: values[2 * i], pending: values[2 * i + 1] }));
  const me = account.toLowerCase();
  const relevant = rows.some((r) => r.owner.toLowerCase() === me || r.pending.toLowerCase() === me);
  panel.hidden = !relevant;
  if (!relevant) return;
  $("admin-list").innerHTML = rows.map((r) => {
    const state = r.owner.toLowerCase() === me ? "You own it"
      : r.pending.toLowerCase() === me ? "Waiting for you to accept" : "Owned by " + r.owner.slice(0, 8) + "…";
    return "<dt>" + r.label + "</dt><dd>" + state + "</dd>";
  }).join("");
  const pendingForMe = rows.filter((r) => r.pending.toLowerCase() === me);
  $("accept").hidden = pendingForMe.length === 0;
  $("accept").dataset.keys = pendingForMe.map((r) => r.k).join(",");
}

async function refreshAdminWithRetry() {
  try {
    await refreshAdmin();
  } catch (e) {
    // The Admin panel is hidden until owners are known, so report on the main log.
    log("w-log", "Connected, but couldn't read contract owners yet (" + (e.shortMessage || e.message).split("\n")[0] + "). Retrying in 10 seconds…", true);
    setTimeout(refreshAdminWithRetry, 10_000);
    return;
  }
  log("w-log", "Connected to " + CFG.chains[chainId].name + ".");
}

async function acceptAll() {
  const d = dep();
  const keys = ($("accept").dataset.keys || "").split(",").filter(Boolean);
  try {
    for (const k of keys) {
      await send("a-log", "Accept ownership of " + k, { address: d[k], abi: ABI.owned, functionName: "acceptOwnership" });
    }
    log("a-log", "Done. You now own " + keys.length + " contract" + (keys.length === 1 ? "" : "s") + ".");
    refreshAdmin();
  } catch (e) { log("a-log", e.shortMessage || e.message, true); }
}

// Wallet discovery (EIP-6963): every installed wallet announces itself, so the user can
// pick one even when several extensions compete for window.ethereum.
const wallets = new Map();
window.addEventListener("eip6963:announceProvider", (e) => {
  const { info, provider } = e.detail || {};
  if (info && provider) wallets.set(info.uuid, { info, provider });
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function chooseWallet() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const list = [...wallets.values()];
  if (window.ethereum && !list.some((w) => w.provider === window.ethereum)) {
    list.push({ info: { uuid: "injected", name: "Browser default wallet", icon: "" }, provider: window.ethereum });
  }
  if (list.length === 0) return Promise.resolve(null);
  // A single wallet in a page without the picker (tests, embedded browsers) connects directly.
  if (list.length === 1 && !$("wallet-picker")) return Promise.resolve(list[0].provider);
  return new Promise((resolve) => {
    const box = $("wallet-picker");
    const ul = $("wallet-list");
    ul.innerHTML = "";
    for (const w of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "wallet-option";
      if (w.info.icon) {
        const img = document.createElement("img");
        img.src = w.info.icon; img.alt = ""; img.width = 28; img.height = 28;
        b.appendChild(img);
      }
      b.appendChild(document.createTextNode(w.info.name));
      b.addEventListener("click", () => { box.hidden = true; resolve(w.provider); });
      ul.appendChild(b);
    }
    $("wallet-cancel").onclick = () => { box.hidden = true; resolve(null); };
    box.hidden = false;
    ul.querySelector("button").focus();
  });
}

async function connect() {
  const provider = await chooseWallet();
  if (!provider) {
    if (wallets.size === 0 && !window.ethereum) {
      log("w-log", "No browser wallet found. Install one (for example MetaMask or Rainbow) and reload.", true);
    }
    return;
  }
  try {
    wallet = createWalletClient({ chain: chainFor(chainId), transport: custom(provider) });
    [account] = await wallet.requestAddresses();
    try {
      await wallet.switchChain({ id: chainId });
    } catch {
      await wallet.addChain({ chain: chainFor(chainId) });
    }
    $("connect").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    log("w-log", "Connected to " + CFG.chains[chainId].name + ".");
    await refresh();
    await refreshAdminWithRetry();
  } catch (e) {
    log("w-log", "Wallet connection failed: " + (e.shortMessage || e.message), true);
  }
}

async function send(logId, label, params) {
  log(logId, label + ": confirm in your wallet…");
  const hash = await wallet.writeContract({ account, chain: chainFor(chainId), ...params });
  log(logId, label + ": waiting for confirmation…");
  const receipt = await client().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(label + " reverted");
  return receipt;
}

async function deposit() {
  const d = dep();
  try {
    const amount = parseUnits($("dep-amount").value || "0", 6);
    if (amount <= 0n) throw new Error("Enter an amount above zero.");
    const allowance = await client().readContract({ address: d.usdg, abi: ABI.erc20, functionName: "allowance", args: [account, d.vault] });
    if (allowance < amount) await send("v-log", "Approve USDG", { address: d.usdg, abi: ABI.erc20, functionName: "approve", args: [d.vault, amount] });
    await send("v-log", "Deposit", { address: d.vault, abi: ABI.vault, functionName: "deposit", args: [amount, account] });
    log("v-log", "Deposited " + usd(amount) + ".");
    refresh();
  } catch (e) { log("v-log", e.shortMessage || e.message, true); }
}

async function withdraw() {
  const d = dep();
  try {
    const amount = parseUnits($("wd-amount").value || "0", 6);
    await send("v-log", "Withdraw", { address: d.vault, abi: ABI.vault, functionName: "withdraw", args: [amount, account, account] });
    log("v-log", "Withdrew " + usd(amount) + ".");
    refresh();
  } catch (e) { log("v-log", e.shortMessage || e.message, true); }
}

function positionInput() {
  const salt = $("c-salt").value.trim() || "0";
  return {
    owner: $("c-owner").value.trim() || account,
    tickLower: parseInt($("c-lower").value, 10),
    tickUpper: parseInt($("c-upper").value, 10),
    salt: "0x" + BigInt(salt).toString(16).padStart(64, "0"),
  };
}

async function quote() {
  const d = dep();
  try {
    const amount = await client().readContract({
      address: d.claims, abi: ABI.claims, functionName: "quoteClaim", args: [poolKey(), BigInt($("c-window").value), positionInput()],
    });
    log("c-log", amount > 0n
      ? "This position can claim " + usd(amount) + " (before any pro rata)."
      : "Nothing to claim for this window. Either LPs didn't lose money, the loss is below the deductible, or the position changed during the window.");
  } catch (e) { log("c-log", e.shortMessage || e.message, true); }
}

async function register() {
  const d = dep();
  try {
    const r = await send("c-log", "Register claim", {
      address: d.claims, abi: ABI.claims, functionName: "registerClaim", args: [poolKey(), BigInt($("c-window").value), positionInput()],
    });
    const topic = r.logs.find((l) => l.address.toLowerCase() === d.claims.toLowerCase());
    const id = topic ? topic.topics[1] : "(see transaction)";
    $("p-claim").value = id;
    log("c-log", "Claim registered. Claim ID " + id + ". Pay it out after the deadline below.");
  } catch (e) { log("c-log", e.shortMessage || e.message, true); }
}

async function settle() {
  const d = dep();
  try {
    await send("s-log", "Settle", { address: d.claims, abi: ABI.claims, functionName: "settle", args: [poolKey(), BigInt($("s-window").value)] });
    log("s-log", "Window settled.");
  } catch (e) { log("s-log", e.shortMessage || e.message, true); }
}

async function payout() {
  const d = dep();
  try {
    await send("s-log", "Pay claim", { address: d.claims, abi: ABI.claims, functionName: "payClaim", args: [$("p-claim").value.trim()] });
    log("s-log", "Claim paid to the registered address.");
    refresh();
  } catch (e) { log("s-log", e.shortMessage || e.message, true); }
}

$("network").value = String(chainId);
$("pool-select").addEventListener("change", refresh);
$("network").addEventListener("change", (e) => { chainId = Number(e.target.value); account = null; $("connect").textContent = "Connect wallet"; refresh(); });
$("connect").addEventListener("click", connect);
$("deposit").addEventListener("click", deposit);
$("withdraw").addEventListener("click", withdraw);
$("quote").addEventListener("click", quote);
$("register").addEventListener("click", register);
$("settle").addEventListener("click", settle);
$("pay").addEventListener("click", payout);
$("accept").addEventListener("click", acceptAll);
$("lp-add").addEventListener("click", addLiquidity);
for (const id of ["lp-usdg", "lp-range"]) $(id).addEventListener("change", () => planLiquidity().catch((e) => log("lp-log", e.shortMessage || e.message, true)));
$("pool-select").addEventListener("change", () => planLiquidity().catch(() => {}));
renderPositions();
planLiquidity().catch(() => {});
refresh();
setInterval(refresh, 30000);
