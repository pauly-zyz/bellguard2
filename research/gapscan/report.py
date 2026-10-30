"""Turn per-window results into a summary and a first premium estimate."""

from __future__ import annotations

import csv
import math
import statistics
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

NUMERIC = {"hours", "swaps_closed", "swaps_reopen", "volume_usd", "p_close", "p_last_closed",
           "p_reopen", "drift", "gap", "markout_usd", "fees_usd", "notional_usd", "markout_bps",
           "il_full_range", "quote_usd"}


def load_rows(path: str | Path) -> list[dict]:
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            for k in NUMERIC:
                v = r.get(k, "")
                r[k] = float(v) if v not in ("", "None", "nan") else None
            r["flags"] = [x for x in (r.get("flags") or "").split(";") if x]
            rows.append(r)
    return rows


def usable(r: dict) -> bool:
    """Rows we trust for pricing: a close and reopen price, a USD value, and
    a reopen that has fully settled."""
    if r["p_close"] is None or r["p_reopen"] is None or r["notional_usd"] in (None, 0):
        return False
    if r["quote_usd"] is None or math.isnan(r["quote_usd"]):
        return False
    return not ({"reopen_not_settled", "reopen_price_fallback", "no_trade_before_close"}
                & set(r["flags"]))


@dataclass
class CoverTerms:
    deductible_bps: float = 25.0   # LP absorbs the first 0.25% of notional
    cap_bps: float = 500.0         # max payout per window: 5% of notional
    loading: float = 1.5           # premium = expected payouts x loading


def payout_usd(r: dict, terms: CoverTerms) -> float:
    """Indemnity-style payout for one pool-window, based on measured LP markout."""
    loss = max(0.0, -(r["markout_usd"] or 0.0))
    notional = r["notional_usd"] or 0.0
    covered = loss - terms.deductible_bps / 1e4 * notional
    return max(0.0, min(covered, terms.cap_bps / 1e4 * notional))


def _fmt_pct(x: float | None, digits: int = 2) -> str:
    return "n/a" if x is None else f"{x * 100:+.{digits}f}%"


def _fmt_usd(x: float | None) -> str:
    return "n/a" if x is None else f"${x:,.0f}"


def build_report(rows: list[dict], terms: CoverTerms) -> str:
    good = [r for r in rows if usable(r)]
    skipped = len(rows) - len(good)
    out: list[str] = []
    out.append("# Bellguard gap scan report\n")
    out.append(f"Pool-windows measured: {len(rows)} (usable: {len(good)}, skipped: {skipped}).\n")
    if not good:
        out.append("Nothing usable to report yet.\n")
        return "\n".join(out)

    windows = sorted({r["window_start"] for r in good})
    out.append(f"Closed windows covered: {len(windows)} "
               f"({windows[0][:10]} to {windows[-1][:10]}).\n")

    # Per-pool summary
    out.append("## Per pool\n")
    out.append("| Pool | Windows | Closed-window volume | LP markout | Fees earned | "
               "Median markout (bps) | Worst (bps) | Median abs gap |")
    out.append("|---|---:|---:|---:|---:|---:|---:|---:|")
    by_pool: dict[str, list[dict]] = defaultdict(list)
    for r in good:
        by_pool[r["pool"]].append(r)
    for pool, rs in sorted(by_pool.items(), key=lambda kv: -sum(x["volume_usd"] or 0 for x in kv[1])):
        bps = [r["markout_bps"] for r in rs if r["markout_bps"] is not None]
        gaps = [abs(r["gap"]) for r in rs if r["gap"] is not None]
        out.append(
            f"| {pool} | {len(rs)} | {_fmt_usd(sum(r['volume_usd'] or 0 for r in rs))} | "
            f"{_fmt_usd(sum(r['markout_usd'] or 0 for r in rs))} | "
            f"{_fmt_usd(sum(r['fees_usd'] or 0 for r in rs))} | "
            f"{statistics.median(bps):+.1f} | {min(bps):+.1f} | "
            f"{_fmt_pct(statistics.median(gaps)) if gaps else 'n/a'} |")

    # Worst windows
    out.append("\n## Worst pool-windows for LPs\n")
    out.append("| Window | Pool | Gap | Markout | Markout (bps) |")
    out.append("|---|---|---:|---:|---:|")
    for r in sorted(good, key=lambda r: r["markout_bps"] or 0)[:10]:
        out.append(f"| {r['window_start'][:10]} {r['window']} | {r['pool']} | {_fmt_pct(r['gap'])} | "
                   f"{_fmt_usd(r['markout_usd'])} | {r['markout_bps']:+.1f} |")

    # Premium estimate
    payouts = [payout_usd(r, terms) for r in good]
    volume = sum(r["volume_usd"] or 0 for r in good)
    total_payout = sum(payouts)
    hits = sum(1 for p in payouts if p > 0)
    out.append("\n## First premium estimate\n")
    out.append(f"Terms: deductible {terms.deductible_bps:g} bps of notional, cap {terms.cap_bps:g} bps "
               f"of notional per window, loading x{terms.loading:g}.\n")
    out.append(f"- Pool-windows with a payout: {hits} of {len(good)}")
    out.append(f"- Total payouts: {_fmt_usd(total_payout)}")
    out.append(f"- Closed-window swap volume: {_fmt_usd(volume)}")
    if volume > 0:
        be = total_payout / volume * 1e4
        out.append(f"- Break-even surcharge on closed-window swaps: {be:.2f} bps")
        out.append(f"- With loading: **{be * terms.loading:.2f} bps** of closed-window volume")
    out.append("\nThe sample is short and pool-priced. Treat these numbers as a first "
               "look, not as final pricing. See docs/research-plan.md for next steps.\n")
    return "\n".join(out)
