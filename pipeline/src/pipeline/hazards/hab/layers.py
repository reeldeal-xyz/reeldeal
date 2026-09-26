"""HAB layers (README §7, §9): daily and monthly SGLI chlorophyll-a.

Only the satellite layers are built so far. Ban and red-tide indices (bulletins) are #80.
"""

from datetime import date
from pathlib import Path

from pipeline.core.clients.jaxa_earth import fetch as jaxa_fetch
from pipeline.core.grid import Grid
from pipeline.core.layers import build_layer, days, months
from pipeline.core.regions import Region

from . import MODULE
from .sources.jaxa_chla import DAILY, MONTHLY


def fetch(start: date, end: date, region: Region, *, refresh: bool = False) -> dict[str, int]:
    bbox = Grid.snap(region.bbox).bbox
    counts: dict[str, int] = {}
    for spec, periods in [*((s, days(start, end)) for s in DAILY), *((s, months(start, end)) for s in MONTHLY)]:
        for when in periods:
            counts[spec.name] = counts.get(spec.name, 0) + len(jaxa_fetch(spec.coll, when, bbox, MODULE, refresh=refresh))
    return counts


def build(start: date, end: date, region: Region, *, offline: bool = False, force: bool = False, months_only: bool = False) -> dict:
    built: dict[str, int] = {}
    missing: dict[str, int] = {}
    jobs = [] if months_only else [(s, d) for d in days(start, end) for s in DAILY]
    jobs += [(s, m) for m in months(start, end) for s in MONTHLY]
    for spec, when in jobs:
        path: Path | None = build_layer(MODULE, spec, when, region, offline=offline, force=force)
        bucket = built if path else missing
        bucket[spec.name] = bucket.get(spec.name, 0) + 1
    return {"built": built, "missing": missing}
