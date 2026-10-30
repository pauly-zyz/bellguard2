"""Measure what each closed window cost (or paid) liquidity providers.

Everything is rebuilt from Swap events, because the public RPC keeps no
historical state: every swap log carries the pool price after the swap, so
"the price at time T" is the price in the last swap at or before T.

Per closed window and pool we compute:

* p_close   - pool price when the market closed
* p_reopen  - pool price `settle` minutes after reopen, once mint/redeem
              arbitrage is back. Used as the "true" price. (A Chainlink
              reference would be better; see docs/research-plan.md.)
* gap       - p_reopen / p_close - 1
* markout   - LP profit and loss on every swap during the closed window,
              valued at p_reopen. Fees are included because swap amounts
              include them. Negative means LPs lost money to weekend flow.
* notional  - value of the pool's active (in-range) liquidity at close,
              2 * L * sqrt(P), used to express markout in basis points.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Callable

from . import chain
from .abi import word_signed, words
from .blocks import BlockClock
from .cache import Cache
from .calendar import ClosedWindow
from .keccak import topic
from .pools import Pool
from .rpc import Rpc

TOPIC_SWAP_V3 = topic("Swap(address,address,int256,int256,uint160,uint128,int24)")
Q96 = 2 ** 96


@dataclass(frozen=True)
class Swap:
    block: int
    log_index: int
    amount0: int        # raw units, pool perspective: + means the pool received
    amount1: int
    sqrt_price_x96: int  # after the swap
    liquidity: int       # in-range liquidity after the swap
    fee: int             # hundredths of a bip


def decode_swap(pool: Pool, log: dict) -> Swap:
    w = words(log["data"])
    if pool.venue == "v3":
        a0, a1 = word_signed(w[0], 256), word_signed(w[1], 256)
        sqrt_p, liq, fee = w[2], w[3], pool.fee
    else:
        # v4 reports the swapper's balance delta: + means the swapper received.
        a0, a1 = -word_signed(w[0], 128), -word_signed(w[1], 128)
        sqrt_p, liq, fee = w[2], w[3], w[5]
    return Swap(int(log["blockNumber"], 16), int(log["logIndex"], 16), a0, a1, sqrt_p, liq, fee)


def fetch_swaps(rpc: Rpc, cache: Cache, pool: Pool, from_block: int, to_block: int,
                *, final_block: int) -> list[Swap]:
    if pool.venue == "v3":
        address, topics = pool.address, [TOPIC_SWAP_V3]
    else:
        address, topics = chain.POOL_MANAGER, [chain.TOPIC_SWAP, pool.pool_id]
    key = f"{pool.venue}:{pool.pool_id}:{from_block}:{to_block}"
    logs = cache.get_or_set("swaps", key,
                            lambda: rpc.get_logs(address, topics, from_block, to_block),
                            store=to_block < final_block - 1000)
    swaps = [decode_swap(pool, log) for log in logs]
    swaps.sort(key=lambda s: (s.block, s.log_index))
    return swaps


def last_swap_before(rpc: Rpc, cache: Cache, pool: Pool, block: int, floor: int,
                     *, final_block: int, first_span: int = 20_000) -> Swap | None:
    """Most recent swap at or before `block`, searching back no further than `floor`.

    Busy pools trade every few seconds, so start with a small range and widen it.
    """
    hi, span = block, first_span
    while hi >= floor:
        lo = max(floor, hi - span + 1)
        swaps = fetch_swaps(rpc, cache, pool, lo, hi, final_block=final_block)
        if swaps:
            return swaps[-1]
        hi, span = lo - 1, span * 4
    return None


# -- price math -------------------------------------------------------------

def stock_price(pool: Pool, sqrt_price_x96: int) -> float:
    """Price of one stock token in quote tokens (human units)."""
    raw = (sqrt_price_x96 / Q96) ** 2                    # token1 raw per token0 raw
    p0_in_1 = raw * 10 ** (pool.decimals0 - pool.decimals1)
    return p0_in_1 if pool.stock_is_token0 else 1.0 / p0_in_1


def human_amounts(pool: Pool, s: Swap) -> tuple[float, float]:
    """(stock amount, quote amount) in human units, pool perspective."""
    a0 = s.amount0 / 10 ** pool.decimals0
    a1 = s.amount1 / 10 ** pool.decimals1
    return (a0, a1) if pool.stock_is_token0 else (a1, a0)


def lp_markout(pool: Pool, swaps: list[Swap], ref_price: float) -> float:
    """LP P&L of these swaps, in quote tokens, valued at ref_price."""
    total = 0.0
    for s in swaps:
        stock, quote = human_amounts(pool, s)
        total += stock * ref_price + quote
    return total


def fee_income(pool: Pool, swaps: list[Swap], ref_price: float) -> float:
    """Fees LPs earned on these swaps, in quote tokens (fee is taken on the input)."""
    total = 0.0
    for s in swaps:
        stock, quote = human_amounts(pool, s)
        rate = s.fee / 1e6 if not s.fee & chain.DYNAMIC_FEE_FLAG else 0.0
        if stock > 0:
            total += stock * rate * ref_price
        elif quote > 0:
            total += quote * rate
    return total


def active_notional(pool: Pool, s: Swap) -> float:
    """Value (in quote) of the virtual reserves of in-range liquidity: 2*L*sqrt(P)."""
    sp = s.sqrt_price_x96 / Q96
    if sp == 0:
        return 0.0
    y_raw = s.liquidity * sp          # token1 side, raw units
    y = y_raw / 10 ** pool.decimals1
    # Both halves have equal value, so total = 2 * token1 side, expressed in quote.
    if pool.stock_is_token0:
        return 2 * y
    return 2 * y * stock_price(pool, s.sqrt_price_x96)


def full_range_il(gap: float) -> float:
    """Impermanent loss of a full-range (v2-style) position for a price move of `gap`."""
    r = 1 + gap
    if r <= 0:
        return 1.0
    return 1 - 2 * math.sqrt(r) / (1 + r)


# -- per-window measurement -----------------------------------------------------

@dataclass
class WindowResult:
    window: str
    window_start: str
    window_end: str
    hours: float
    pool: str
    pool_id: str
    stock: str
    quote: str
    swaps_closed: int
    swaps_reopen: int
    volume_usd: float
    p_close: float | None
    p_last_closed: float | None
    p_reopen: float | None
    drift: float | None          # p_last_closed / p_close - 1
    gap: float | None            # p_reopen / p_close - 1
    markout_usd: float
    fees_usd: float
    notional_usd: float
    markout_bps: float | None
    il_full_range: float | None
    quote_usd: float
    flags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["flags"] = ";".join(self.flags)
        return d


def measure_window(rpc: Rpc, cache: Cache, clock: BlockClock, pool: Pool,
                   window: ClosedWindow, *, settle_minutes: int = 60,
                   lookback_hours: int = 72,
                   quote_usd: Callable[[Pool, int], float] = lambda p, b: 1.0
                   ) -> WindowResult:
    b_look = clock.block_at(window.start_ts - lookback_hours * 3600)
    b_start = clock.block_at(window.start_ts)
    b_end = clock.block_at(window.end_ts - 1)
    b_settle = clock.block_at(window.end_ts + settle_minutes * 60)

    swaps = fetch_swaps(rpc, cache, pool, b_start + 1, b_settle, final_block=clock.latest)
    closed = [s for s in swaps if s.block <= b_end]
    reopen = [s for s in swaps if b_end < s.block <= b_settle]
    last_pre = last_swap_before(rpc, cache, pool, b_start, b_look, final_block=clock.latest)
    pre = [last_pre] if last_pre else []

    flags: list[str] = []
    if b_settle >= clock.latest:
        flags.append("reopen_not_settled")
    if not pre:
        flags.append("no_trade_before_close")
    if not reopen:
        flags.append("no_trade_after_reopen")

    p_close = stock_price(pool, pre[-1].sqrt_price_x96) if pre else None
    last_closed = (closed or pre)[-1] if (closed or pre) else None
    p_last_closed = stock_price(pool, last_closed.sqrt_price_x96) if last_closed else None
    p_reopen = stock_price(pool, reopen[-1].sqrt_price_x96) if reopen else None
    if p_reopen is None and p_last_closed is not None:
        p_reopen = p_last_closed
        flags.append("reopen_price_fallback")

    usd = quote_usd(pool, b_settle)
    markout = lp_markout(pool, closed, p_reopen) if p_reopen else 0.0
    fees = fee_income(pool, closed, p_reopen) if p_reopen else 0.0
    volume = sum(abs(human_amounts(pool, s)[1]) for s in closed)
    notional = active_notional(pool, pre[-1]) if pre else 0.0

    gap = (p_reopen / p_close - 1) if p_close and p_reopen else None
    drift = (p_last_closed / p_close - 1) if p_close and p_last_closed else None
    return WindowResult(
        window=window.label,
        window_start=window.start.isoformat(),
        window_end=window.end.isoformat(),
        hours=round(window.hours, 2),
        pool=pool.label,
        pool_id=pool.pool_id,
        stock=pool.stock_symbol,
        quote=pool.quote_symbol,
        swaps_closed=len(closed),
        swaps_reopen=len(reopen),
        volume_usd=volume * usd,
        p_close=p_close,
        p_last_closed=p_last_closed,
        p_reopen=p_reopen,
        drift=drift,
        gap=gap,
        markout_usd=markout * usd,
        fees_usd=fees * usd,
        notional_usd=notional * usd,
        markout_bps=(markout / notional * 1e4) if notional else None,
        il_full_range=full_range_il(gap) if gap is not None else None,
        quote_usd=usd,
        flags=flags,
    )


class QuoteUsd:
    """USD value of a quote token at a block. USDG counts as $1; WETH is priced
    from the most liquid WETH/USDG v3 pool, using its last swap before the block."""

    def __init__(self, rpc: Rpc, cache: Cache, clock: BlockClock, weth_usdg: Pool | None):
        self.rpc, self.cache, self.clock, self.ref = rpc, cache, clock, weth_usdg
        self._memo: dict[int, float] = {}

    def __call__(self, pool: Pool, block: int) -> float:
        if pool.quote_token == chain.USDG:
            return 1.0
        if pool.quote_token != chain.WETH or self.ref is None:
            return float("nan")
        if block not in self._memo:
            lo = self.clock.block_at(self.clock.ts(block) - 24 * 3600)
            swaps = fetch_swaps(self.rpc, self.cache, self.ref, lo, block,
                                final_block=self.clock.latest)
            # ref pool's "stock" side is WETH, so stock_price = ETH in USDG
            self._memo[block] = (stock_price(self.ref, swaps[-1].sqrt_price_x96)
                                 if swaps else float("nan"))
        return self._memo[block]
