"""Command line entry point: python -m gapscan <command> ..."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import chain
from .abi import call_data, words
from .analysis import QuoteUsd, measure_window, stock_price
from .blocks import BlockClock
from .cache import Cache
from .calendar import closed_windows
from .pools import Pool, stock_tokens, v3_pools, v4_pool, weth_usdg_pool
from .report import CoverTerms, build_report, load_rows
from .rpc import DEFAULT_RPC, Rpc, RpcError

MAINNET_LAUNCH = "2026-07-01"


def _date(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def _current_notional_usd(rpc: Rpc, pools: list[Pool], eth_usd: float) -> list[float]:
    """Value of in-range liquidity right now (latest state is always available)."""
    res = rpc.batch([("eth_call", [{"to": p.address, "data": call_data("slot0()")}, "latest"])
                     for p in pools])
    out = []
    for p, r in zip(pools, res):
        if isinstance(r, RpcError) or r == "0x":
            out.append(0.0)
            continue
        sqrt_p = words(r)[0] / 2 ** 96
        y = p.liquidity * sqrt_p / 10 ** p.decimals1
        sp = stock_price(p, words(r)[0])
        notional = 2 * y if p.stock_is_token0 else 2 * y * sp
        usd = 1.0 if p.quote_token == chain.USDG else eth_usd
        out.append(notional * usd)
    return out


def cmd_discover(args: argparse.Namespace) -> None:
    rpc = Rpc(args.rpc, verbose=args.verbose)
    cache = Cache(args.cache)
    latest = rpc.block_number()
    stocks = stock_tokens(rpc, cache, latest)
    print(f"Stock tokens from StockFactory: {len(stocks)}")
    pools = v3_pools(rpc, stocks)
    ref = weth_usdg_pool(rpc)
    eth_usd = float("nan")
    if ref:
        slot = words(rpc.eth_call(ref.address, call_data("slot0()")))[0]
        eth_usd = stock_price(ref, slot)
        print(f"WETH/USDG reference pool: {ref.address} (ETH = ${eth_usd:,.0f})")
    for pid in args.v4 or []:
        pools.append(v4_pool(rpc, pid, stocks, latest))

    v3 = [p for p in pools if p.venue == "v3"]
    notionals = dict(zip((p.pool_id for p in v3), _current_notional_usd(rpc, v3, eth_usd)))
    rows = []
    for p in pools:
        d = p.to_dict()
        d["label"] = p.label
        d["notional_usd_now"] = notionals.get(p.pool_id)
        rows.append(d)
    rows.sort(key=lambda d: -(d["notional_usd_now"] or 0))
    Path(args.out).write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "block": latest,
        "weth_usdg_reference": ref.to_dict() if ref else None,
        "pools": rows,
    }, indent=2))
    print(f"Pools with in-range liquidity: {len(rows)} -> {args.out}")
    for d in rows[:args.show]:
        n = d["notional_usd_now"]
        print(f"  {d['label']:<28} {d['pool_id']}  "
              f"{'n/a' if n is None or math.isnan(n) else f'${n:,.0f}'}")


def cmd_windows(args: argparse.Namespace) -> None:
    until = _date(args.until) if args.until else datetime.now(timezone.utc)
    for w in closed_windows(_date(args.since), until):
        print(f"{w.start:%Y-%m-%d %H:%M} -> {w.end:%Y-%m-%d %H:%M} UTC  "
              f"{w.hours:5.1f}h  {w.label}")


def cmd_scan(args: argparse.Namespace) -> None:
    data = json.loads(Path(args.pools).read_text())
    pools = [Pool.from_dict({k: v for k, v in d.items()
                             if k in Pool.__dataclass_fields__}) for d in data["pools"]]
    if args.only:
        want = {s.strip().upper() for s in args.only.split(",")}
        pools = [p for p in pools if p.stock_symbol.upper() in want]
    if args.min_notional:
        keep = {d["pool_id"] for d in data["pools"]
                if (d.get("notional_usd_now") or 0) >= args.min_notional}
        pools = [p for p in pools if p.pool_id in keep]
    pools = pools[:args.top]
    if not pools:
        sys.exit("No pools selected. Run `discover` first or relax --only/--min-notional.")

    rpc = Rpc(args.rpc, verbose=args.verbose)
    cache = Cache(args.cache)
    clock = BlockClock(rpc, cache, first_block=chain.POOL_MANAGER_DEPLOY_BLOCK)
    ref = Pool.from_dict(data["weth_usdg_reference"]) if data.get("weth_usdg_reference") else None
    quote_usd = QuoteUsd(rpc, cache, clock, ref)
    until = _date(args.until) if args.until else datetime.fromtimestamp(clock.latest_ts, timezone.utc)
    windows = closed_windows(_date(args.since), until)
    print(f"Scanning {len(pools)} pools x {len(windows)} closed windows ...")

    rows = []
    for p in pools:
        for w in windows:
            try:
                r = measure_window(rpc, cache, clock, p, w, settle_minutes=args.settle,
                                   quote_usd=quote_usd)
            except RpcError as e:
                print(f"  ! {p.label} {w.start:%Y-%m-%d}: {e}")
                continue
            rows.append(r.to_dict())
            bps = "n/a" if r.markout_bps is None else f"{r.markout_bps:+.1f} bps"
            gap = "n/a" if r.gap is None else f"{r.gap * 100:+.2f}%"
            print(f"  {p.label:<26} {w.start:%Y-%m-%d} gap {gap:>8}  markout ${r.markout_usd:>10,.0f}"
                  f"  ({bps})  swaps {r.swaps_closed}")
    if not rows:
        sys.exit("No results.")
    with open(args.out, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows -> {args.out} ({rpc.requests} RPC requests)")


def cmd_report(args: argparse.Namespace) -> None:
    rows = load_rows(args.results)
    text = build_report(rows, CoverTerms(args.deductible_bps, args.cap_bps, args.loading))
    if args.out:
        Path(args.out).write_text(text)
        print(f"Report -> {args.out}")
    else:
        print(text)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="gapscan", description=__doc__)
    ap.add_argument("--rpc", default=DEFAULT_RPC)
    ap.add_argument("--cache", default=".cache", help="cache dir ('' to disable)")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("discover", help="find stock pools against USDG/WETH")
    d.add_argument("--out", default="pools.json")
    d.add_argument("--v4", action="append", help="also include this Uniswap v4 pool id")
    d.add_argument("--show", type=int, default=20)
    d.set_defaults(fn=cmd_discover)

    w = sub.add_parser("windows", help="list closed-market windows")
    w.add_argument("--since", default=MAINNET_LAUNCH)
    w.add_argument("--until")
    w.set_defaults(fn=cmd_windows)

    s = sub.add_parser("scan", help="measure LP markout per closed window")
    s.add_argument("--pools", default="pools.json")
    s.add_argument("--since", default=MAINNET_LAUNCH)
    s.add_argument("--until")
    s.add_argument("--only", help="comma-separated stock symbols, e.g. TSLA,NVDA")
    s.add_argument("--top", type=int, default=10, help="max pools (by current notional)")
    s.add_argument("--min-notional", type=float, default=0.0)
    s.add_argument("--settle", type=int, default=60, help="minutes after reopen for p_reopen")
    s.add_argument("--out", default="results.csv")
    s.set_defaults(fn=cmd_scan)

    r = sub.add_parser("report", help="summarise results and estimate a premium")
    r.add_argument("results", nargs="?", default="results.csv")
    r.add_argument("--deductible-bps", type=float, default=25.0)
    r.add_argument("--cap-bps", type=float, default=500.0)
    r.add_argument("--loading", type=float, default=1.5)
    r.add_argument("--out")
    r.set_defaults(fn=cmd_report)

    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
