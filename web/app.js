// Bellguard app: wallet, vault, claims and settlement. Uses viem from jsDelivr.
import {
  createPublicClient, createWalletClient, custom, http, parseAbi, formatUnits, parseUnits, defineChain,
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
});
const dep = () => CFG.chains[chainId] && CFG.chains[chainId].deployment;
const client = () => createPublicClient({ chain: chainFor(chainId), transport: http(CFG.chains[chainId].rpc) });
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
  try {
    const c = client();
    const [closed, surcharge, assets, supply, locked] = await Promise.all([
      c.readContract({ address: d.calendar, abi: ABI.calendar, functionName: "isClosedNow" }),
      c.readContract({ address: d.hook, abi: ABI.hook, functionName: "currentSurchargeBps", args: [d.pool] }),
      c.readContract({ address: d.vault, abi: ABI.vault, functionName: "totalAssets" }),
      c.readContract({ address: d.vault, abi: ABI.vault, functionName: "totalSupply" }),
      c.readContract({ address: d.vault, abi: ABI.vault, functionName: "isLocked" }),
    ]);
    $("m-state").textContent = closed ? "Closed" : "Open";
    $("m-surcharge").textContent = (Number(surcharge) / 100).toFixed(2) + "%";
    $("v-assets").textContent = usd(assets);
    $("v-price").textContent = supply > 0n
      ? (Number(assets) / Number(supply) * 1e6).toFixed(4) + " USDG" // shares carry 6 extra decimals
      : "1.0000 USDG";
    $("v-locked").textContent = locked ? "Locked (closed or claims open)" : "Unlocked";
    if (account) {
      const [shares, maxW] = await Promise.all([
        c.readContract({ address: d.vault, abi: ABI.vault, functionName: "balanceOf", args: [account] }),
        c.readContract({ address: d.vault, abi: ABI.vault, functionName: "maxWithdraw", args: [account] }),
      ]);
      const value = await c.readContract({ address: d.vault, abi: ABI.vault, functionName: "convertToAssets", args: [shares] });
      $("v-mine").textContent = usd(value) + " (withdrawable now " + usd(maxW) + ")";
    }
  } catch (e) {
    log("v-log", "Couldn't read contracts: " + (e.shortMessage || e.message), true);
  }
}

async function connect() {
  if (!window.ethereum) {
    log("w-log", "No browser wallet found. Install one (for example MetaMask) and reload.", true);
    return;
  }
  try {
    wallet = createWalletClient({ chain: chainFor(chainId), transport: custom(window.ethereum) });
    [account] = await wallet.requestAddresses();
    try {
      await wallet.switchChain({ id: chainId });
    } catch {
      await wallet.addChain({ chain: chainFor(chainId) });
    }
    $("connect").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    log("w-log", "Connected to " + CFG.chains[chainId].name + ".");
    await refresh();
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
      address: d.claims, abi: ABI.claims, functionName: "quoteClaim", args: [d.pool, BigInt($("c-window").value), positionInput()],
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
      address: d.claims, abi: ABI.claims, functionName: "registerClaim", args: [d.pool, BigInt($("c-window").value), positionInput()],
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
    await send("s-log", "Settle", { address: d.claims, abi: ABI.claims, functionName: "settle", args: [d.pool, BigInt($("s-window").value)] });
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

$("network").addEventListener("change", (e) => { chainId = Number(e.target.value); account = null; $("connect").textContent = "Connect wallet"; refresh(); });
$("connect").addEventListener("click", connect);
$("deposit").addEventListener("click", deposit);
$("withdraw").addEventListener("click", withdraw);
$("quote").addEventListener("click", quote);
$("register").addEventListener("click", register);
$("settle").addEventListener("click", settle);
$("pay").addEventListener("click", payout);
refresh();
setInterval(refresh, 30000);
