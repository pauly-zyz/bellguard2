"""Find stock tokens and the pools where they trade against USDG or WETH.

Finding (2026-10-30): the stock/USDG and stock/WETH liquidity on Robinhood
Chain sits in Uniswap v3 pools. Uniswap v4 hosts thousands of memecoin
pools quoted *in* stock tokens, but no TSLA/USDG or TSLA/WETH pool at all.
So discovery covers v3 automatically, and v4 pools can be added by pool id.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from . import chain
from .abi import (address_from_topic, address_from_word, call_data, decode_string,
                  enc_address, enc_uint, words, word_signed)
from .cache import Cache
from .rpc import Rpc, RpcError

V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa"
V3_FEES = (100, 500, 3000, 10000)


@dataclass
class StockToken:
    address: str
    symbol: str
    name: str


@dataclass
class Pool:
    venue: str        # "v3" or "v4"
    address: str      # v3: pool contract; v4: PoolManager
    pool_id: str      # v4 pool id; v3: same as address
    token0: str
    token1: str
    decimals0: int
    decimals1: int
    symbol0: str
    symbol1: str
    fee: int          # hundredths of a bip; v4 dynamic-fee pools report 0x800000
    stock_is_token0: bool
    liquidity: int = 0

    @property
    def stock_symbol(self) -> str:
        return self.symbol0 if self.stock_is_token0 else self.symbol1

    @property
    def quote_symbol(self) -> str:
        return self.symbol1 if self.stock_is_token0 else self.symbol0

    @property
    def quote_token(self) -> str:
        return self.token1 if self.stock_is_token0 else self.token0

    @property
    def label(self) -> str:
        fee = "dyn" if self.fee & chain.DYNAMIC_FEE_FLAG else f"{self.fee / 1e4:g}%"
        return f"{self.stock_symbol}/{self.quote_symbol} {self.venue} {fee}"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Pool":
        return cls(**d)


def stock_tokens(rpc: Rpc, cache: Cache, latest: int) -> list[StockToken]:
    """Every token created by Robinhood's StockFactory."""
    def fetch() -> list[dict[str, str]]:
        logs = rpc.get_logs(chain.STOCK_FACTORY, [chain.TOPIC_STOCK_CREATED], 0, latest)
        out = {}
        for log in logs:
            addr = address_from_word(words(log["data"])[0])
            out[addr] = {"address": addr, "name": decode_string(log["data"], 1),
                         "symbol": decode_string(log["data"], 2)}
        return list(out.values())

    rows = cache.get_or_set("stock_tokens", str(latest // 100_000), fetch)
    return [StockToken(**r) for r in rows]


def _decimals(rpc: Rpc, tokens: list[str]) -> dict[str, int]:
    res = rpc.batch([("eth_call", [{"to": t, "data": call_data("decimals()")}, "latest"])
                     for t in tokens])
    return {t: (words(r)[0] if not isinstance(r, RpcError) and r != "0x" else 18)
            for t, r in zip(tokens, res)}


def v3_pools(rpc: Rpc, stocks: list[StockToken], *, min_liquidity: int = 1) -> list[Pool]:
    quotes = list(chain.QUOTE_TOKENS)
    combos = [(s, q, fee) for s in stocks for q in quotes for fee in V3_FEES]
    res = rpc.batch([
        ("eth_call", [{"to": V3_FACTORY, "data": call_data(
            "getPool(address,address,uint24)", enc_address(s.address), enc_address(q),
            enc_uint(fee))}, "latest"])
        for s, q, fee in combos
    ])
    found = []
    for (s, q, fee), r in zip(combos, res):
        if isinstance(r, RpcError) or r == "0x":
            continue
        addr = address_from_word(words(r)[0])
        if int(addr, 16):
            found.append((s, q, fee, addr))
    if not found:
        return []

    liq = rpc.batch([("eth_call", [{"to": a, "data": call_data("liquidity()")}, "latest"])
                     for _, _, _, a in found])
    decs = _decimals(rpc, list(chain.QUOTE_TOKENS) + [s.address for s, *_ in found])

    pools = []
    for (s, q, fee, addr), l in zip(found, liq):
        liquidity = 0 if isinstance(l, RpcError) or l == "0x" else words(l)[0]
        if liquidity < min_liquidity:
            continue
        stock_first = int(s.address, 16) < int(q, 16)
        t0, t1 = (s.address, q) if stock_first else (q, s.address)
        sym = {s.address: s.symbol, q: chain.QUOTE_TOKENS[q]}
        pools.append(Pool("v3", addr, addr, t0, t1, decs.get(t0, 18), decs.get(t1, 18),
                          sym[t0], sym[t1], fee, stock_first, liquidity))
    pools.sort(key=lambda p: (p.stock_symbol, p.quote_symbol, p.fee))
    return pools


def weth_usdg_pool(rpc: Rpc) -> Pool | None:
    """Most liquid WETH/USDG v3 pool, used to price WETH-quoted pools in USD."""
    weth = StockToken(chain.WETH, "WETH", "Wrapped Ether")
    best = None
    for fee in V3_FEES:
        r = rpc.eth_call(V3_FACTORY, call_data("getPool(address,address,uint24)",
                                               enc_address(chain.WETH), enc_address(chain.USDG),
                                               enc_uint(fee)))
        addr = address_from_word(words(r)[0])
        if not int(addr, 16):
            continue
        liq = words(rpc.eth_call(addr, call_data("liquidity()")))[0]
        if best is None or liq > best[1]:
            best = (fee, liq, addr)
    if best is None:
        return None
    fee, liq, addr = best
    first = int(weth.address, 16) < int(chain.USDG, 16)
    t0, t1 = (chain.WETH, chain.USDG) if first else (chain.USDG, chain.WETH)
    d = {chain.WETH: 18, chain.USDG: 6}
    s = {chain.WETH: "WETH", chain.USDG: "USDG"}
    return Pool("v3", addr, addr, t0, t1, d[t0], d[t1], s[t0], s[t1], fee, first, liq)


def v4_pool(rpc: Rpc, pool_id: str, stocks: list[StockToken], latest: int) -> Pool:
    """Describe a Uniswap v4 pool from its Initialize event."""
    pool_id = pool_id.lower()
    logs = rpc.get_logs(chain.POOL_MANAGER, [chain.TOPIC_INITIALIZE, pool_id],
                        chain.POOL_MANAGER_DEPLOY_BLOCK, latest)
    if not logs:
        raise ValueError(f"no Initialize event for v4 pool {pool_id}")
    log = logs[0]
    t0 = address_from_topic(log["topics"][2])
    t1 = address_from_topic(log["topics"][3])
    w = words(log["data"])
    fee = w[0]
    _ = word_signed(w[1], 24)  # tick spacing (unused)
    by_addr = {s.address: s for s in stocks}
    if t0 not in by_addr and t1 not in by_addr:
        raise ValueError(f"v4 pool {pool_id} has no Robinhood stock token")
    stock_first = t0 in by_addr

    def sym(t: str) -> str:
        if t in by_addr:
            return by_addr[t].symbol
        if t == "0x" + "0" * 40:
            return "ETH"
        return chain.QUOTE_TOKENS.get(t) or decode_string(rpc.eth_call(t, call_data("symbol()")))

    decs = {t: 18 if t == "0x" + "0" * 40 else d
            for t, d in _decimals(rpc, [t0, t1]).items()}
    return Pool("v4", chain.POOL_MANAGER, pool_id, t0, t1, decs[t0], decs[t1],
                sym(t0), sym(t1), fee, stock_first)
