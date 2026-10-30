"""Map timestamps to block numbers (the public RPC has no such method)."""

from __future__ import annotations

from .cache import Cache
from .rpc import Rpc, RpcError

PROBES = 48  # block headers fetched per batch round


class BlockClock:
    def __init__(self, rpc: Rpc, cache: Cache, *, first_block: int = 1):
        self.rpc = rpc
        self.cache = cache
        self.first = first_block
        self.latest = rpc.block_number()
        self.latest_ts = rpc.block_timestamp(self.latest)
        self._ts: dict[int, int] = {self.latest: self.latest_ts}
        self._at: dict[int, int] = {}

    def ts(self, number: int) -> int:
        if number not in self._ts:
            self._ts[number] = self.rpc.block_timestamp(number)
        return self._ts[number]

    def _timestamps(self, numbers: list[int]) -> None:
        missing = [n for n in numbers if n not in self._ts]
        if not missing:
            return
        res = self.rpc.batch([("eth_getBlockByNumber", [hex(n), False]) for n in missing])
        for n, r in zip(missing, res):
            if isinstance(r, RpcError) or r is None:
                self._ts[n] = self.rpc.block_timestamp(n)
            else:
                self._ts[n] = int(r["timestamp"], 16)

    def _search(self, timestamp: int) -> int:
        lo, hi = self.first, self.latest  # invariant: ts(lo) <= timestamp < ts(hi)
        self._timestamps([lo])
        if self._ts[lo] > timestamp:
            return lo
        while hi - lo > 1:
            step = max(1, (hi - lo) // (PROBES + 1))
            probes = list(range(lo + step, hi, step))[:PROBES]
            self._timestamps(probes)
            for n in probes:
                if self._ts[n] <= timestamp:
                    lo = n
                else:
                    hi = n
                    break
        return lo

    def block_at(self, timestamp: int) -> int:
        """Last block with block.timestamp <= timestamp."""
        if timestamp >= self.latest_ts:
            return self.latest
        if timestamp not in self._at:
            store = timestamp < self.latest_ts - 3600
            self._at[timestamp] = self.cache.get_or_set(
                "block_at", str(timestamp), lambda: self._search(timestamp), store=store)
        return self._at[timestamp]
