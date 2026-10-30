// Read-only JSON-RPC relay for the Bellguard app (Vercel serverless function).
//
// Browsers talk to /api/rpc on the site's own domain; this function forwards the call to
// Robinhood Chain. That avoids networks or extensions that block the chain's RPC host,
// and a short cache keeps the app under the public RPC's rate limit.
// Only read methods are relayed: transactions are always signed and sent by the user's wallet.

const UPSTREAM = {
  4663: process.env.RPC_MAINNET || "https://rpc.mainnet.chain.robinhood.com",
  46630: process.env.RPC_TESTNET || "https://rpc.testnet.chain.robinhood.com",
};

const ALLOWED = new Set([
  "eth_chainId", "eth_blockNumber", "eth_call", "eth_getBalance", "eth_getCode",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber",
  "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
  "eth_getTransactionCount", "net_version",
]);
// Cache only calls whose answer can't go stale within a few seconds in a way that matters.
const CACHE_MS = { eth_chainId: 3_600_000, net_version: 3_600_000, eth_call: 4_000, eth_blockNumber: 2_000, eth_getCode: 60_000 };
const cache = new Map();

async function forward(url, body) {
  let delay = 400;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "bellguard-web/1.0" },
      body: JSON.stringify(body),
    });
    if (res.status !== 429 && res.status < 500) return res.json();
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
  throw new Error("upstream busy");
}

async function handleOne(url, chainId, call) {
  const id = call && call.id !== undefined ? call.id : null;
  if (!call || call.jsonrpc !== "2.0" || typeof call.method !== "string") {
    return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid request" } };
  }
  if (!ALLOWED.has(call.method)) {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not allowed on this relay" } };
  }
  const ttl = CACHE_MS[call.method];
  const key = ttl ? chainId + ":" + call.method + ":" + JSON.stringify(call.params || []) : null;
  const hit = key && cache.get(key);
  if (hit && hit.expires > Date.now()) return { ...hit.value, id };

  const out = await forward(url, { jsonrpc: "2.0", id: 1, method: call.method, params: call.params || [] });
  if (key && out && out.result !== undefined) {
    cache.set(key, { value: out, expires: Date.now() + ttl });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
  }
  return { ...out, id };
}

module.exports = async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const chainId = Number((req.query && req.query.chain) || 4663);
  const url = UPSTREAM[chainId];
  if (!url) return res.status(400).json({ error: "unknown chain" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON" }); }
  }
  try {
    const out = Array.isArray(body)
      ? await Promise.all(body.slice(0, 20).map((c) => handleOne(url, chainId, c)))
      : await handleOne(url, chainId, body);
    res.setHeader("cache-control", "no-store");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ jsonrpc: "2.0", id: body && body.id, error: { code: -32603, message: "Robinhood Chain RPC unavailable, try again" } });
  }
};
