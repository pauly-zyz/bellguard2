// Read-only JSON-RPC relay for the Bellguard app (Vercel serverless function).
//
// Browsers talk to /api/rpc on the site's own domain; this function forwards the call to
// Robinhood Chain. That avoids networks or extensions that block the chain's RPC host,
// and a short cache keeps the app under the public RPC's rate limit.
// Only read methods are relayed: transactions are always signed and sent by the user's wallet.

const UPSTREAM = {
  4663: process.env.RPC_MAINNET || "https://rpc.mainnet.chain.robinhood.com",
  46630: process.env.RPC_TESTNET || "https://rpc.testnet.chain.robinhood.com",
  99901: process.env.RPC_ELYSIUM || "https://rpc.elysium.kinetiq.xyz",
  99801: process.env.RPC_ELYSIUM_TESTNET || "https://testnet-rpc.elysium.kinetiq.xyz",
};

const ALLOWED = new Set([
  "eth_chainId", "eth_blockNumber", "eth_call", "eth_getBalance", "eth_getCode",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber",
  "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
  "eth_getTransactionCount", "net_version", "eth_getLogs",
]);
// Cache only calls whose answer can't go stale within a few seconds in a way that matters.
const CACHE_MS = { eth_chainId: 3_600_000, net_version: 3_600_000, eth_call: 4_000, eth_blockNumber: 2_000, eth_getCode: 60_000, eth_getLogs: 30_000 };
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

/** Check a call; returns an error response, or null if it may be relayed. */
function reject(call) {
  const id = call && call.id !== undefined ? call.id : null;
  if (!call || call.jsonrpc !== "2.0" || typeof call.method !== "string") {
    return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid request" } };
  }
  if (!ALLOWED.has(call.method)) {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not allowed on this relay" } };
  }
  if (call.method === "eth_getLogs") {
    const f = (call.params || [])[0] || {};
    if (!f.address || Array.isArray(f.address)) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: "eth_getLogs needs a single contract address on this relay" } };
    }
  }
  return null;
}

const UPSTREAM_BATCH = 5; // public RPCs (e.g. Elysium on Conduit) allow only a few calls per burst

/** Answer a list of calls: cached ones locally, the rest in upstream JSON-RPC batches (one request
 *  per 20 calls, not one per call, so the chain's rate limit isn't hit). A failed call only fails itself. */
async function handleMany(url, chainId, calls) {
  const out = new Array(calls.length);
  const todo = [];
  calls.forEach((call, i) => {
    const bad = reject(call);
    if (bad) { out[i] = bad; return; }
    const ttl = CACHE_MS[call.method];
    const key = ttl ? chainId + ":" + call.method + ":" + JSON.stringify(call.params || []) : null;
    const hit = key && cache.get(key);
    if (hit && hit.expires > Date.now()) { out[i] = { ...hit.value, id: call.id }; return; }
    todo.push({ i, call, key, ttl });
  });
  for (let j = 0; j < todo.length; j += UPSTREAM_BATCH) {
    const chunk = todo.slice(j, j + UPSTREAM_BATCH);
    // Send the chunk; retry calls the RPC rate-limited (code -32017 / 429-style errors) with backoff.
    const byId = new Map();
    let pending = chunk.map((t, k) => k);
    for (let attempt = 0, delay = 300; attempt < 4 && pending.length; attempt++, delay *= 2) {
      if (attempt) await new Promise((r) => setTimeout(r, delay));
      let res = null;
      try {
        res = await forward(url, pending.map((k) => ({ jsonrpc: "2.0", id: k, method: chunk[k].call.method, params: chunk[k].call.params || [] })));
      } catch { continue; }
      for (const r of Array.isArray(res) ? res : []) byId.set(r.id, r);
      pending = pending.filter((k) => { const r = byId.get(k); return !r || (r.error && /rate limit/i.test(r.error.message || "")); });
    }
    chunk.forEach((t, k) => {
      const r = byId.get(k);
      if (!r) { out[t.i] = { jsonrpc: "2.0", id: t.call.id, error: { code: -32603, message: "Chain RPC busy, try again" } }; return; }
      if (t.key && r.result !== undefined) {
        cache.set(t.key, { value: { jsonrpc: "2.0", result: r.result }, expires: Date.now() + t.ttl });
        if (cache.size > 500) cache.delete(cache.keys().next().value);
      }
      out[t.i] = { ...r, id: t.call.id };
    });
  }
  return out;
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
      ? await handleMany(url, chainId, body.slice(0, 100))
      : (await handleMany(url, chainId, [body]))[0];
    res.setHeader("cache-control", "no-store");
    // A single call that failed upstream is a 502 so clients fall back to their next RPC.
    const failed = !Array.isArray(out) && out && out.error && out.error.code === -32603;
    return res.status(failed ? 502 : 200).json(out);
  } catch (e) {
    return res.status(502).json({ jsonrpc: "2.0", id: body && body.id, error: { code: -32603, message: "Chain RPC unavailable, try again" } });
  }
};
