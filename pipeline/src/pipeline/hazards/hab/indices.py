"""BANWEEKS and BAN_ACTIVE from restriction intervals (README §7). Pure functions: no I/O.

For each day from `restricted_from` up to (not including) `lifted_on`, the restriction is in force:
`BAN_ACTIVE` = 1 and `BANWEEKS` = the 1-based count of weeks under restriction, (day - restricted_from) // 7 + 1.
Prefectures test weekly, so the count steps up on each weekly test date: a ban from 2026-05-12 reaches 4 on
2026-06-02 (tests 05-12, 05-19, 05-26, 06-02). The lift date itself is published, so it gets 0 / 0. An open
restriction runs to `through` (normally today). Days outside every published interval are omitted, not 0: the
bulletins say when a ban starts and lifts, not that a sea area was tested clear on every other day.
"""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta

from pipeline.core.schemas import Source

from .schemas import BanInterval

BANWEEKS_UNIT = "weeks"
BAN_ACTIVE_UNIT = "0/1"


@dataclass(frozen=True)
class BanDay:
    day: date
    species: str
    toxin: str
    banweeks: int
    active: int
    source: Source


def source_of(ban: BanInterval) -> Source:
    """Provenance of a ban value: the reviewed bulletin it was transcribed from."""
    return Source(product=f"{ban.pref}-shellfish-toxin-bulletin", sha256=ban.sha256)


def ban_days(bans: Iterable[BanInterval], start: date, end: date, through: date) -> list[BanDay]:
    """One BanDay per restricted (or lift) day within [start, end], ordered by species, toxin and day."""
    days: dict[tuple[str, str, date], BanDay] = {}
    for ban in bans:
        last = ban.lifted_on if ban.lifted_on is not None else through
        d = max(ban.restricted_from, start)
        while d <= min(last, end):
            lifted = ban.lifted_on is not None and d >= ban.lifted_on
            weeks = 0 if lifted else (d - ban.restricted_from).days // 7 + 1
            key = (ban.species, ban.toxin, d)
            prev = days.get(key)
            # Overlapping intervals for one species and toxin (a re-listing): keep the longer-running count.
            if prev is None or weeks > prev.banweeks:
                days[key] = BanDay(d, ban.species, ban.toxin, weeks, 0 if lifted else 1, source_of(ban))
            d += timedelta(days=1)
    return [days[k] for k in sorted(days)]


def by_series(days: Iterable[BanDay]) -> dict[tuple[str, str], list[BanDay]]:
    grouped: dict[tuple[str, str], list[BanDay]] = defaultdict(list)
    for d in days:
        grouped[(d.species, d.toxin)].append(d)
    return dict(grouped)
