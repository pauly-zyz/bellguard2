"""Chainlink stock prices on Robinhood Chain, rebuilt from AnswerUpdated logs.

Feed addresses are found on-chain: every Chainlink aggregator emits
AnswerUpdated, and its description() names the asset ("Robinhood TSLA / USD",
"RHSPY / USD", "Robinhood SGOV-USD"). That avoids depending on Chainlink's
feed directory. Robinhood's docs say these prices already include the
ERC-8056 multiplier, so they compare directly with pool prices.

Aggregators can be replaced over time, so a symbol may map to several
aggregators. Their updates are merged into one time series.
"""

from __future__ import annotations

import bisect
import re
from dataclasses import dataclass

from .abi import call_data, decode_string, to_signed, words
from .cache import Cache
from .keccak import topic
from .rpc import Rpc, RpcError

TOPIC_ANSWER_UPDATED = topic("AnswerUpdated(int256,uint256,uint256)")


def feed_symbol(description: str) -> str | None:
    """'Robinhood TSLA / USD' -> 'TSLA'; 'RHSPY / USD' -> 'SPY'. None if not a Robinhood feed."""
    d = description.strip()
    m = re.match(r"^(?:Robinhood\s+|RH)([A-Z0-9.]+)\s*[-/]\s*USD\b", d)
    return m.group(1) if m else None


@dataclass(frozen=True)
class Update:
    block: int
    log_index: int
    price: float
    updated_at: int


class ChainlinkPrices:
    def __init__(self, rpc: Rpc, cache: Cache, from_block: int, to_block: int):
        self.rpc, self.cache = rpc, cache
        self.from_block, self.to_block = from_block, to_block
        self._series: dict[str, list[Update]] = {}
        self._blocks: dict[str, list[tuple[int, int]]] = {}
        self.feeds: dict[str, list[str]] = {}
        self._load()

    def _load(self) -> None:
        def fetch() -> list[list]:
            logs = self.rpc.get_logs(None, [TOPIC_ANSWER_UPDATED], self.from_block, self.to_block)
            # [address, block, logIndex, answer (signed int), updatedAt]
            return [[log["address"].lower(), int(log["blockNumber"], 16), int(log["logIndex"], 16),
                     to_signed(int(log["topics"][1], 16)), words(log["data"])[0]]
                    for log in logs if len(log["topics"]) > 1]

        key = f"{self.from_block}:{self.to_block}"
        rows = self.cache.get_or_set("chainlink_logs", key, fetch)
        by_addr: dict[str, list[list]] = {}
        for row in rows:
            by_addr.setdefault(row[0], []).append(row)

        addrs = sorted(by_addr)
        meta = self.cache.get_or_set("chainlink_meta", ",".join(addrs), lambda: self._meta(addrs))
        for addr in addrs:
            desc, decimals = meta.get(addr, (None, None))
            sym = feed_symbol(desc) if desc else None
            if sym is None or decimals is None:
                continue
            self.feeds.setdefault(sym, []).append(addr)
            series = self._series.setdefault(sym, [])
            for _, block, idx, answer, updated_at in by_addr[addr]:
                series.append(Update(block, idx, answer / 10 ** decimals, updated_at))
        for sym, series in self._series.items():
            series.sort(key=lambda u: (u.block, u.log_index))
            self._blocks[sym] = [(u.block, u.log_index) for u in series]

    def _meta(self, addrs: list[str]) -> dict[str, tuple[str | None, int | None]]:
        desc = self.rpc.batch([("eth_call", [{"to": a, "data": call_data("description()")}, "latest"])
                               for a in addrs])
        dec = self.rpc.batch([("eth_call", [{"to": a, "data": call_data("decimals()")}, "latest"])
                              for a in addrs])
        out = {}
        for a, d, n in zip(addrs, desc, dec):
            try:
                ds = None if isinstance(d, RpcError) or d == "0x" else decode_string(d)
            except Exception:
                ds = None
            dn = None if isinstance(n, RpcError) or n == "0x" else words(n)[0]
            out[a] = (ds, dn)
        return out

    def symbols(self) -> list[str]:
        return sorted(self._series)

    def price_at(self, symbol: str, block: int) -> Update | None:
        """Last update at or before `block`."""
        series = self._series.get(symbol)
        if not series:
            return None
        i = bisect.bisect_right(self._blocks[symbol], (block, 1 << 62)) - 1
        return series[i] if i >= 0 else None

    def first_after(self, symbol: str, block: int, until: int) -> Update | None:
        """First update strictly after `block` and at or before `until`."""
        series = self._series.get(symbol)
        if not series:
            return None
        i = bisect.bisect_right(self._blocks[symbol], (block, 1 << 62))
        if i < len(series) and series[i].block <= until:
            return series[i]
        return None
