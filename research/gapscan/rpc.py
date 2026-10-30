"""Minimal JSON-RPC client for Robinhood Chain (stdlib only).

Handles the public endpoint's limits: a custom User-Agent (the default
Python one is refused), retry with backoff on 429/5xx, batching, and
eth_getLogs paging that splits ranges when the node says "too many logs".
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any, Iterable

DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com"
USER_AGENT = "bellguard-gapscan/0.1"

# Public-endpoint limits observed on 2026-10-30.
MAX_LOG_RANGE = 10_000_000  # blocks per eth_getLogs
MAX_BATCH = 50


class RpcError(RuntimeError):
    def __init__(self, error: dict[str, Any]):
        self.code = error.get("code")
        self.message = str(error.get("message", ""))
        super().__init__(f"RPC error {self.code}: {self.message}")


class Rpc:
    def __init__(self, url: str = DEFAULT_RPC, *, min_interval: float = 0.15,
                 max_retries: int = 6, timeout: float = 60.0, verbose: bool = False):
        self.url = url
        self.min_interval = min_interval
        self.max_retries = max_retries
        self.timeout = timeout
        self.verbose = verbose
        self._last = 0.0
        self.requests = 0
        self._span_hint: dict[str, int] = {}

    # -- transport -----------------------------------------------------------
    def _post(self, payload: Any) -> Any:
        body = json.dumps(payload).encode()
        delay = 1.0
        for attempt in range(self.max_retries + 1):
            wait = self.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            req = urllib.request.Request(self.url, body, {
                "content-type": "application/json",
                "user-agent": USER_AGENT,
            })
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    self.requests += 1
                    return json.load(resp)
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < self.max_retries:
                    retry_after = e.headers.get("retry-after") if e.headers else None
                    sleep = float(retry_after) if retry_after and retry_after.isdigit() else delay
                    if self.verbose:
                        print(f"  rpc HTTP {e.code}, retry in {sleep:.1f}s")
                    time.sleep(sleep)
                    delay = min(delay * 2, 30)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt < self.max_retries:
                    time.sleep(delay)
                    delay = min(delay * 2, 30)
                    continue
                raise RuntimeError(f"RPC unreachable: {e}") from e
        raise RuntimeError("unreachable")

    def call(self, method: str, params: list[Any]) -> Any:
        resp = self._post({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        if "error" in resp:
            raise RpcError(resp["error"])
        return resp["result"]

    def batch(self, calls: Iterable[tuple[str, list[Any]]]) -> list[Any]:
        """Run calls in batches. Failed entries come back as RpcError instances."""
        calls = list(calls)
        out: list[Any] = []
        for i in range(0, len(calls), MAX_BATCH):
            chunk = calls[i:i + MAX_BATCH]
            payload = [{"jsonrpc": "2.0", "id": j, "method": m, "params": p}
                       for j, (m, p) in enumerate(chunk)]
            resp = self._post(payload)
            if isinstance(resp, dict):  # whole batch rejected
                raise RpcError(resp.get("error", {"message": str(resp)}))
            by_id = {r["id"]: r for r in resp}
            for j in range(len(chunk)):
                r = by_id.get(j)
                if r is None:
                    out.append(RpcError({"message": "missing batch response"}))
                elif "error" in r:
                    out.append(RpcError(r["error"]))
                else:
                    out.append(r["result"])
        return out

    # -- helpers -------------------------------------------------------------
    def block_number(self) -> int:
        return int(self.call("eth_blockNumber", []), 16)

    def block_timestamp(self, number: int) -> int:
        # Load-balanced nodes can briefly return null for a block another node
        # just reported as the head, so retry a few times.
        for attempt in range(5):
            block = self.call("eth_getBlockByNumber", [hex(number), False])
            if block is not None:
                return int(block["timestamp"], 16)
            time.sleep(1 + attempt)
        raise RuntimeError(f"block {number} not available")

    def latest_block(self) -> tuple[int, int]:
        """(number, timestamp) of the head block, read in one call."""
        block = self.call("eth_getBlockByNumber", ["latest", False])
        return int(block["number"], 16), int(block["timestamp"], 16)

    def eth_call(self, to: str, data: str, block: int | str = "latest") -> str:
        tag = hex(block) if isinstance(block, int) else block
        return self.call("eth_call", [{"to": to, "data": data}, tag])

    def get_logs(self, address: str | list[str] | None, topics: list[Any],
                 from_block: int, to_block: int) -> list[dict[str, Any]]:
        """eth_getLogs over any range.

        Walks forward with an adaptive block span: it shrinks when the node
        says a chunk holds too many logs, grows when chunks come back small,
        and remembers the span per address for the next call.
        """
        key = str(address)
        span = min(self._span_hint.get(key, MAX_LOG_RANGE), MAX_LOG_RANGE)
        logs: list[dict[str, Any]] = []
        lo = from_block
        while lo <= to_block:
            hi = min(lo + span - 1, to_block)
            flt: dict[str, Any] = {"fromBlock": hex(lo), "toBlock": hex(hi), "topics": topics}
            if address is not None:
                flt["address"] = address
            try:
                chunk = self.call("eth_getLogs", [flt])
            except RpcError as e:
                msg = e.message.lower()
                if hi > lo and ("exceeds limit" in msg or "too many" in msg
                                or "narrow" in msg or "range" in msg):
                    span = max(1, (hi - lo + 1) // 3)
                    continue
                raise
            logs.extend(chunk)
            lo = hi + 1
            if len(chunk) < 2_500:
                span = min(span * 2, MAX_LOG_RANGE)
        self._span_hint[key] = span
        return logs
