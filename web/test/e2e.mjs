// End-to-end test of web/app.html and web/index.html against a local anvil chain.
// Clicks through the app like a user: deposit, withdraw, settle, claim, pay out.
// Setup and usage: see web/test/README.md
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from "viem";
import fs from "fs";

const RPC = process.env.RPC || "http://127.0.0.1:8545";
const SITE = process.env.SITE || "http://127.0.0.1:8766";
const DEPLOYMENT = process.env.DEPLOYMENT || new URL("../../contracts/deployments/demo-31337.json", import.meta.url).pathname;
const VIEM_BUNDLE = process.env.VIEM_BUNDLE; // optional: local viem build when the CDN is unreachable
const OUT = process.env.OUT || ".";
const D = JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8"));
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const chain = { id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wal = createWalletClient({ chain, transport: http(RPC) });
const rpc = (method, params = []) => pub.request({ method, params });

const stockIs0 = BigInt(D.stock) < BigInt(D.usdg);
const POOL = { currency0: stockIs0 ? D.stock : D.usdg, currency1: stockIs0 ? D.usdg : D.stock, fee: 3000, tickSpacing: 60, hooks: D.hook };
const LOWER = -227100, UPPER = -215100;
const W0 = { start: 1793408400, end: 1793581200 };

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const vaultAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalAssets() view returns (uint256)"]);
const swapAbi = parseAbi(["function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,(bool takeClaims,bool settleUsingBurn) testSettings,bytes hookData) payable returns (int256)"]);
const feedAbi = parseAbi(["function set(int256)"]);

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  — " + detail : ""));
}

async function warp(ts) {
  await rpc("evm_setNextBlockTimestamp", [ts]);
  await rpc("evm_mine");
}

async function openApp(browser, account) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !(m.location().url || "").includes("fonts.g")) errors.push(m.text() + " @ " + (m.location().url || "")); });
  if (VIEM_BUNDLE) {
    await page.route("https://cdn.jsdelivr.net/npm/viem@2.21.54/+esm", (r) =>
      r.fulfill({ contentType: "application/javascript", body: fs.readFileSync(VIEM_BUNDLE) }));
  }
  await page.route("**/fonts.googleapis.com/**", (r) => r.abort());
  await page.route(SITE + "/config.js", (r) => r.fulfill({
    contentType: "application/javascript",
    body: "window.BELLGUARD_CONFIG = " + JSON.stringify({
      defaultChainId: 31337,
      chains: { 31337: { name: "Local anvil", rpc: RPC, deployment: { ...D, pool: POOL } } },
    }) + ";",
  }));
  await page.addInitScript(({ account, rpcUrl }) => {
    let id = 0;
    window.ethereum = {
      async request({ method, params }) {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
        if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
        const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params || [] }) });
        const j = await res.json();
        if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
        return j.result;
      },
      on() {}, removeListener() {},
    };
  }, { account, rpcUrl: RPC });
  await page.goto(SITE + "/app.html", { waitUntil: "load" });
  await connectWallet(page);
  await page.waitForTimeout(1500);
  return { page, errors };
}

async function connectWallet(page) {
  await page.click("#connect");
  // The app always offers a wallet picker; take the first (only) wallet.
  await page.waitForSelector("#wallet-picker:not([hidden]) .wallet-option", { timeout: 10000 });
  await page.click("#wallet-list .wallet-option");
  await page.waitForFunction(() => document.getElementById("w-log").textContent.includes("Connected"), null, { timeout: 15000 });
}

const waitLog = (page, id, text, timeout = 30000) =>
  page.waitForFunction(([id, text]) => document.getElementById(id).textContent.includes(text), [id, text], { timeout });

const browser = await chromium.launch();
try {
  // 1. Underwriter flow (market open)
  let { page, errors } = await openApp(browser, DEPLOYER);
  check("app connects wallet", true);
  check("deployed banner hidden", await page.locator("#not-deployed").isHidden());
  const assetsText = await page.textContent("#v-assets");
  check("vault assets read from chain", assetsText.startsWith("$1,000,000"), assetsText);
  check("market shows open before weekend", (await page.textContent("#m-state")) === "Open");

  const sharesBefore = await pub.readContract({ address: D.vault, abi: vaultAbi, functionName: "balanceOf", args: [DEPLOYER] });
  await page.fill("#dep-amount", "1000");
  await page.click("#deposit");
  await waitLog(page, "v-log", "Deposited");
  const sharesAfter = await pub.readContract({ address: D.vault, abi: vaultAbi, functionName: "balanceOf", args: [DEPLOYER] });
  check("deposit 1,000 USDG via UI mints shares", sharesAfter > sharesBefore, `shares +${sharesAfter - sharesBefore}`);

  const usdgBefore = await pub.readContract({ address: D.usdg, abi: erc20, functionName: "balanceOf", args: [DEPLOYER] });
  await page.fill("#wd-amount", "500");
  await page.click("#withdraw");
  await waitLog(page, "v-log", "Withdrew");
  const usdgAfter = await pub.readContract({ address: D.usdg, abi: erc20, functionName: "balanceOf", args: [DEPLOYER] });
  check("withdraw 500 USDG via UI while open", usdgAfter - usdgBefore === 500_000000n, formatUnits(usdgAfter - usdgBefore, 6));
  check("no page errors (underwriter flow)", errors.length === 0, errors.join(" | "));
  await page.close();

  // 2. Weekend: market closes, weekend traders buy stock
  await warp(W0.start + 3600);
  const vaultUsdg0 = await pub.readContract({ address: D.usdg, abi: erc20, functionName: "balanceOf", args: [D.vault] });
  for (let i = 0; i < 3; i++) {
    const hash = await wal.writeContract({ account: DEPLOYER, address: D.swapRouter, abi: swapAbi, functionName: "swap",
      args: [POOL, { zeroForOne: !stockIs0, amountSpecified: -100000_000000n,
        sqrtPriceLimitX96: stockIs0 ? 1461446703485210103287273052203988822378723970341n : 4295128740n },
        { takeClaims: false, settleUsingBurn: false }, "0x"] });
    await pub.waitForTransactionReceipt({ hash });
  }
  // Sell a little stock so a USDG premium lands in the vault too
  {
    const hash = await wal.writeContract({ account: DEPLOYER, address: D.swapRouter, abi: swapAbi, functionName: "swap",
      args: [POOL, { zeroForOne: stockIs0, amountSpecified: -10n * 10n ** 18n,
        sqrtPriceLimitX96: stockIs0 ? 4295128740n : 1461446703485210103287273052203988822378723970341n },
        { takeClaims: false, settleUsingBurn: false }, "0x"] });
    await pub.waitForTransactionReceipt({ hash });
  }
  const vaultUsdg1 = await pub.readContract({ address: D.usdg, abi: erc20, functionName: "balanceOf", args: [D.vault] });
  check("closed-market swap premium reached the vault", vaultUsdg1 > vaultUsdg0, formatUnits(vaultUsdg1 - vaultUsdg0, 6) + " USDG");

  ({ page, errors } = await openApp(browser, DEPLOYER));
  check("market shows closed during weekend", (await page.textContent("#m-state")) === "Closed");
  check("surcharge shown while closed", (await page.textContent("#m-surcharge")) === "0.10%", await page.textContent("#m-surcharge"));
  check("withdrawals shown locked", (await page.textContent("#v-locked")).startsWith("Locked"), await page.textContent("#v-locked"));
  await page.fill("#wd-amount", "1");
  await page.click("#withdraw");
  await page.waitForFunction(() => document.getElementById("v-log").style.color.includes("closed"), null, { timeout: 15000 });
  check("withdraw rejected while closed (error shown)", true, (await page.textContent("#v-log")).slice(0, 80));
  await page.close();

  // 3. Monday reopen: Chainlink shows +20%, settle from the UI
  await warp(W0.end + 3600 + 60);
  let hash = await wal.writeContract({ account: DEPLOYER, address: D.feed, abi: feedAbi, functionName: "set", args: [300_00000000n] });
  await pub.waitForTransactionReceipt({ hash });
  ({ page, errors } = await openApp(browser, DEPLOYER));
  await page.fill("#s-window", "0");
  await page.click("#settle");
  await waitLog(page, "s-log", "Window settled");
  check("settle window 0 via UI", true);
  await page.close();

  // 4. LP claims (the demo position is owned by the v4 test router; impersonate it)
  await rpc("anvil_impersonateAccount", [D.lpRouter]);
  await rpc("anvil_setBalance", [D.lpRouter, "0x56BC75E2D63100000"]);
  ({ page, errors } = await openApp(browser, D.lpRouter));
  await page.fill("#c-window", "0");
  await page.fill("#c-salt", "0");
  await page.fill("#c-lower", String(LOWER));
  await page.fill("#c-upper", String(UPPER));
  await page.fill("#c-owner", D.lpRouter);
  await page.click("#quote");
  await waitLog(page, "c-log", "claim");
  const quoteText = await page.textContent("#c-log");
  check("check amount via UI", quoteText.includes("can claim $"), quoteText);
  await page.click("#register");
  await waitLog(page, "c-log", "Claim registered");
  const claimId = await page.inputValue("#p-claim");
  check("register claim via UI", /^0x[0-9a-f]{64}$/.test(claimId), claimId.slice(0, 18) + "…");

  // 5. After the claim deadline: pay out from the UI
  await warp(W0.end + 3600 + 2 * 86400 + 60);
  await page.reload({ waitUntil: "load" });
  await connectWallet(page);
  await page.fill("#p-claim", claimId);
  const before = await pub.readContract({ address: D.usdg, abi: erc20, functionName: "balanceOf", args: [D.lpRouter] });
  await page.click("#pay");
  await waitLog(page, "s-log", "Claim paid");
  const after = await pub.readContract({ address: D.usdg, abi: erc20, functionName: "balanceOf", args: [D.lpRouter] });
  check("pay claim via UI transfers USDG to the LP", after > before, "+" + formatUnits(after - before, 6) + " USDG");
  check("no page errors (claims flow)", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: OUT + "/app-after-e2e.png", fullPage: true });
  await page.close();

  // 6. Landing page
  const lp = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const lerr = [];
  lp.on("pageerror", (e) => lerr.push(e.message));
  await lp.route("**/fonts.googleapis.com/**", (r) => r.abort());
  await lp.goto(SITE + "/", { waitUntil: "load" });
  await lp.waitForTimeout(1200);
  const dots = await lp.locator("#findings svg circle").count();
  const rows = await lp.locator("#findings tbody tr").count();
  const cd1 = await lp.textContent("#clock .countdown");
  await lp.waitForTimeout(1500);
  const cd2 = await lp.textContent("#clock .countdown");
  check("landing chart renders all data points", dots === 65, dots + " dots");
  check("landing table has 5 pools", rows === 5, rows + " rows");
  check("market clock is ticking", cd1 !== cd2 && cd1 !== "--", cd1 + " → " + cd2);
  check("no page errors (landing)", lerr.length === 0, lerr.join(" | "));
  await lp.close();
} catch (e) {
  check("unexpected error", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  fs.writeFileSync(OUT + "/e2e-results.json", JSON.stringify(results, null, 2));
  process.exit(failed ? 1 : 0);
}
