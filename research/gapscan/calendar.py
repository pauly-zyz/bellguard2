"""When is the "real" market for Robinhood stock tokens closed?

Robinhood's docs describe a tokenization window of Monday 02:00 to Saturday
02:00 Central European Time (Europe/Berlin, so CET or CEST). Outside it,
tokens cannot be minted or redeemed and the Chainlink stock feeds stop
updating, but the tokens keep trading in on-chain pools. Those closed
windows are where liquidity providers carry gap risk.

On top of the weekly closure we add US market holidays. Assumption: a
holiday on US date D closes the session from 20:00 New York time on D-1 to
20:00 on D, matching the 24/5 overnight session. Verify this against
Robinhood's notices before relying on it. Holiday lists also need a yearly
update.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")
NEW_YORK = ZoneInfo("America/New_York")

# NYSE full-day closures. Source: NYSE holiday calendar; check yearly.
US_MARKET_HOLIDAYS: dict[date, str] = {
    date(2026, 1, 1): "New Year's Day",
    date(2026, 1, 19): "Martin Luther King Jr. Day",
    date(2026, 2, 16): "Washington's Birthday",
    date(2026, 4, 3): "Good Friday",
    date(2026, 5, 25): "Memorial Day",
    date(2026, 6, 19): "Juneteenth",
    date(2026, 7, 3): "Independence Day (observed)",
    date(2026, 9, 7): "Labor Day",
    date(2026, 11, 26): "Thanksgiving Day",
    date(2026, 12, 25): "Christmas Day",
    date(2027, 1, 1): "New Year's Day",
    date(2027, 1, 18): "Martin Luther King Jr. Day",
    date(2027, 2, 15): "Washington's Birthday",
    date(2027, 3, 26): "Good Friday",
    date(2027, 5, 31): "Memorial Day",
    date(2027, 6, 18): "Juneteenth (observed)",
    date(2027, 7, 5): "Independence Day (observed)",
    date(2027, 9, 6): "Labor Day",
    date(2027, 11, 25): "Thanksgiving Day",
    date(2027, 12, 24): "Christmas Day (observed)",
}


@dataclass(frozen=True)
class ClosedWindow:
    start: datetime  # UTC, inclusive
    end: datetime    # UTC, exclusive: the market reopens here
    label: str

    @property
    def hours(self) -> float:
        return (self.end - self.start).total_seconds() / 3600

    @property
    def start_ts(self) -> int:
        return int(self.start.timestamp())

    @property
    def end_ts(self) -> int:
        return int(self.end.timestamp())


def _utc(d: date, t: time, tz: ZoneInfo) -> datetime:
    return datetime.combine(d, t, tzinfo=tz).astimezone(timezone.utc)


def _weekend(saturday: date) -> tuple[datetime, datetime, str]:
    start = _utc(saturday, time(2, 0), BERLIN)
    end = _utc(saturday + timedelta(days=2), time(2, 0), BERLIN)
    return start, end, "weekend"


def _holiday(day: date, name: str) -> tuple[datetime, datetime, str]:
    start = _utc(day - timedelta(days=1), time(20, 0), NEW_YORK)
    end = _utc(day, time(20, 0), NEW_YORK)
    return start, end, name


def closed_windows(start: datetime, end: datetime, *,
                   holidays: dict[date, str] | None = None) -> list[ClosedWindow]:
    """Closed windows that overlap [start, end), merged where they touch.

    A Friday or Monday holiday merges with the weekend into one longer window,
    which is how LPs experience it: one gap, measured at the next reopen.
    """
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("start and end must be timezone-aware")
    hol = US_MARKET_HOLIDAYS if holidays is None else holidays

    raw: list[tuple[datetime, datetime, str]] = []
    d = (start - timedelta(days=3)).date()
    last = (end + timedelta(days=3)).date()
    while d <= last:
        if d.weekday() == 5:
            raw.append(_weekend(d))
        if d in hol:
            raw.append(_holiday(d, hol[d]))
        d += timedelta(days=1)

    raw.sort()
    merged: list[list] = []
    for s, e, label in raw:
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
            if label not in merged[-1][2]:
                merged[-1][2].append(label)
        else:
            merged.append([s, e, [label]])

    return [ClosedWindow(s, e, " + ".join(labels))
            for s, e, labels in merged if e > start and s < end]


def is_closed(moment: datetime, *, holidays: dict[date, str] | None = None) -> bool:
    return any(w.start <= moment < w.end
               for w in closed_windows(moment - timedelta(days=1),
                                       moment + timedelta(days=1), holidays=holidays))
