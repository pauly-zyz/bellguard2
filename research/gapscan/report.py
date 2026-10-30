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
           "il_full_range", "quote_usd", "cl_close", "cl_reopen", "cl_gap", "markout_cl_usd",
           "markout_cl_bps", "pool_vs_cl_reopen"}


def load_rows(path: str | Path) -> list[dict]:
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            for k in NUMERIC:
                v = r.get(k, "")
                r[k] = float(v) if v not in ("", "None", "nan", None) else None
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


def loss_basis(r: dict) -> tuple[float, str]:
    """LP markout used for payouts: Chainlink-referenced when available."""
    if r.get("markout_cl_usd") is not None:
        return r["markout_cl_usd"], "chainlink"
    return r["markout_usd"] or 0.0, "pool"


def ref_gap(r: dict) -> float | None:
    return r["cl_gap"] if r.get("cl_gap") is not None else r["gap"]


def capital_factor(width: float | None) -> float:
    """Capital of a concentrated position relative to full range, for the same
    liquidity L, with range [P/(1+w), P*(1+w)] centred on the price: 1 - (1+w)^-1/2.

    In-range positions earn and lose the same per unit of L, so dividing a
    pool-level markout by factor * notional gives the markout as a share of that
    position's capital. Valid while the price stays inside the range.
    """
    if width is None:
        return 1.0
    return 1 - (1 + width) ** -0.5


RANGES = [("full range", None), ("±20% range", 0.20), ("±5% range", 0.05)]


@dataclass
class CoverTerms:
    deductible_bps: float = 25.0   # LP absorbs the first 0.25% of notional
    cap_bps: float = 500.0         # max payout per window: 5% of notional
    loading: float = 1.5           # premium = expected payouts x loading


def payout_usd(r: dict, terms: CoverTerms, width: float | None = None) -> float:
    """Payout for one pool-window, based on measured LP markout (GapCoverMath.payout).

    `width` evaluates the same window for LPs in a concentrated range: the loss
    is unchanged, but deductible and cap apply to the smaller capital.
    """
    markout, _ = loss_basis(r)
    loss = max(0.0, -markout)
    notional = (r["notional_usd"] or 0.0) * capital_factor(width)
    covered = loss - terms.deductible_bps / 1e4 * notional
    return max(0.0, min(covered, terms.cap_bps / 1e4 * notional))


def _fmt_pct(x: float | None, digits: int = 2) -> str:
    return "n/a" if x is None else f"{x * 100:+.{digits}f}%"


def _fmt_usd(x: float | None) -> str:
    return "n/a" if x is None else f"${x:,.0f}"


def build_report(rows: list[dict], terms: CoverTerms) -> str:
    good = [r for r in rows if usable(r)]
    skipped = len(rows) - len(good)
    with_cl = [r for r in good if r.get("markout_cl_usd") is not None]
    out: list[str] = []
    out.append("# Bellguard gap scan report\n")
    out.append(f"Pool-windows measured: {len(rows)} (usable: {len(good)}, skipped: {skipped}). "
               f"Chainlink-referenced: {len(with_cl)}.\n")
    if not good:
        out.append("Nothing usable to report yet.\n")
        return "\n".join(out)

    windows = sorted({r["window_start"] for r in good})
    out.append(f"Closed windows covered: {len(windows)} "
               f"({windows[0][:10]} to {windows[-1][:10]}).\n")

    # Headline
    lost = [r for r in good if loss_basis(r)[0] < 0]
    total_mk = sum(loss_basis(r)[0] for r in good)
    out.append("## Headline\n")
    out.append(f"- LPs lost money in **{len(lost)} of {len(good)}** pool-windows "
               f"(LP markout below zero, fees included).")
    out.append(f"- Net LP markout over all closed windows: **{_fmt_usd(total_mk)}** "
               f"(positive = LPs gained).")
    if lost:
        worst = min(lost, key=lambda r: loss_basis(r)[0])
        out.append(f"- Worst: {worst['pool']} on {worst['window_start'][:10]}: "
                   f"{_fmt_usd(loss_basis(worst)[0])}, gap {_fmt_pct(ref_gap(worst))}.")
    gaps = [abs(g) for g in (ref_gap(r) for r in good) if g is not None]
    if gaps:
        out.append(f"- Reopen gaps: median {statistics.median(gaps) * 100:.2f}%, "
                   f"largest {max(gaps) * 100:.2f}%; above 3%: {sum(g > 0.03 for g in gaps)}, "
                   f"above 5%: {sum(g > 0.05 for g in gaps)}.")
    dev = [abs(r["pool_vs_cl_reopen"]) for r in with_cl if r.get("pool_vs_cl_reopen") is not None]
    if dev:
        out.append(f"- Pool vs Chainlink price at settle: median {statistics.median(dev) * 100:.2f}% "
                   f"apart, max {max(dev) * 100:.2f}%.")
    out.append("")

    # Per-pool summary
    out.append("## Per pool\n")
    out.append("| Pool | Windows | Closed-window volume | Fees earned | LP markout (pool ref) | "
               "LP markout (Chainlink ref) | Windows with LP loss | Largest abs gap |")
    out.append("|---|---:|---:|---:|---:|---:|---:|---:|")
    by_pool: dict[str, list[dict]] = defaultdict(list)
    for r in good:
        by_pool[r["pool"]].append(r)
    for pool, rs in sorted(by_pool.items(), key=lambda kv: -sum(x["volume_usd"] or 0 for x in kv[1])):
        cl = [r["markout_cl_usd"] for r in rs if r.get("markout_cl_usd") is not None]
        pg = [abs(g) for g in (ref_gap(r) for r in rs) if g is not None]
        largest = f"{max(pg) * 100:.2f}%" if pg else "n/a"
        cl_text = f"{_fmt_usd(sum(cl))} ({len(cl)} windows)" if cl else "n/a"
        out.append(
            f"| {pool} | {len(rs)} | {_fmt_usd(sum(r['volume_usd'] or 0 for r in rs))} | "
            f"{_fmt_usd(sum(r['fees_usd'] or 0 for r in rs))} | "
            f"{_fmt_usd(sum(r['markout_usd'] or 0 for r in rs))} | {cl_text} | "
            f"{sum(1 for r in rs if loss_basis(r)[0] < 0)} | {largest} |")

    # Worst windows
    out.append("\n## Worst pool-windows for LPs\n")
    out.append("| Window | Pool | Gap | LP markout | Basis | Markout (bps of notional) |")
    out.append("|---|---|---:|---:|---|---:|")
    for r in sorted(good, key=lambda r: loss_basis(r)[0])[:10]:
        mk, basis = loss_basis(r)
        bps = mk / r["notional_usd"] * 1e4 if r["notional_usd"] else 0.0
        out.append(f"| {r['window_start'][:10]} {r['window']} | {r['pool']} | {_fmt_pct(ref_gap(r))} | "
                   f"{_fmt_usd(mk)} | {basis} | {bps:+.2f} |")

    # Premium estimate
    payouts = [payout_usd(r, terms) for r in good]
    volume = sum(r["volume_usd"] or 0 for r in good)
    total_payout = sum(payouts)
    hits = sum(1 for p in payouts if p > 0)
    out.append("\n## Premium estimate (cover every window)\n")
    out.append(f"Terms: deductible {terms.deductible_bps:g} bps of notional, cap {terms.cap_bps:g} bps "
               f"of notional per window, loading x{terms.loading:g}.\n")
    out.append(f"- Pool-windows with a payout: {hits} of {len(good)}")
    out.append(f"- Total payouts: {_fmt_usd(total_payout)}")
    out.append(f"- Closed-window swap volume: {_fmt_usd(volume)}")
    if volume > 0:
        be = total_payout / volume * 1e4
        out.append(f"- Break-even surcharge on closed-window swaps: {be:.2f} bps")
        out.append(f"- With loading: **{be * terms.loading:.2f} bps** of closed-window volume")

    # Concentrated liquidity view
    out.append("\n## By LP range width\n")
    out.append("Same windows, expressed as a share of the capital of an LP whose range is centred "
               "on the price. Narrow ranges put less capital behind the same liquidity, so the "
               "same dollar loss is a bigger percentage.\n")
    out.append("| LP range | Worst window (bps of capital) | Windows with loss > 25 bps | "
               "Payouts under the terms above | Break-even surcharge (bps of volume) |")
    out.append("|---|---:|---:|---:|---:|")
    for name, width in RANGES:
        f = capital_factor(width)
        bps = [loss_basis(r)[0] / (r["notional_usd"] * f) * 1e4 for r in good if r["notional_usd"]]
        pay = sum(payout_usd(r, terms, width) for r in good)
        be = f"{pay / volume * 1e4:.2f}" if volume > 0 else "n/a"
        out.append(f"| {name} | {min(bps):+.1f} | {sum(b < -25 for b in bps)} | "
                   f"{_fmt_usd(pay)} | {be} |")

    out.append("\nThe sample is short. Treat these numbers as a first look, not as final "
               "pricing. See docs/research-plan.md for next steps.\n")
    return "\n".join(out)
