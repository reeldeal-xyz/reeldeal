"""Heat layers (README §6, §9): daily SST per product, the COBE daily normal, and monthly SST composites."""

from datetime import date
from pathlib import Path

from pipeline.core.layers import LayerSpec, build_layer
from pipeline.core.regions import Region

from . import MODULE
from .sources.cobe_normal import COBE_NORMAL
from .sources.jaxa_sst import DAILY_ORDER, MONTHLY

DAILY: tuple[LayerSpec, ...] = (*DAILY_ORDER, COBE_NORMAL)

# A heat season `YYYY` is 1 June to 31 October: the app's payout window (07-01..09-30, packages/shared rules.ts)
# with a month either side for context. The pipeline publishes values for the whole season; windows are the app's.
SEASON_START = (6, 1)
SEASON_END = (10, 31)


def season_window(season: str) -> tuple[date, date]:
    if not (season.isdigit() and len(season) == 4):
        raise ValueError(f"season must be a year (YYYY), got {season!r}")
    y = int(season)
    return date(y, *SEASON_START), date(y, *SEASON_END)


def season_of(day: date) -> str | None:
    start, end = season_window(str(day.year))
    return str(day.year) if start <= day <= end else None


def build_day(day: date, region: Region, **kw) -> dict[str, Path | None]:
    return {spec.name: build_layer(MODULE, spec, day, region, **kw) for spec in DAILY}


def build_month(month: date, region: Region, **kw) -> dict[str, Path | None]:
    return {spec.name: build_layer(MODULE, spec, month, region, **kw) for spec in MONTHLY}
