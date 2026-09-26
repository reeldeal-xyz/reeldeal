"""HAB router (README §7). Shellfish toxin restrictions (BANWEEKS, BAN_ACTIVE), chlorophyll-a layers and their map
tiles are served; red tides and the hab-onset forecast are not implemented yet.

Ban indices are computed per request from the reviewed restrictions in PostGIS (`bans.py`, `indices.py`); a sea
area's values apply to every plot in it. Routes that read the database answer 503 while it is unavailable.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, status
from shapely.geometry import shape

from pipeline.core.errors import not_implemented, stub
from pipeline.core.layers import layers_on
from pipeline.core.plots import store
from pipeline.core.regions import sea_area, sea_area_of
from pipeline.core.schemas import IndexPoint, IndexSeries, IndicesResponse, LayerInfo, Window
from pipeline.core.tiles import add_tile_route

from . import MODULE, MODULE_VERSION, bans
from .indices import BAN_ACTIVE_UNIT, BANWEEKS_UNIT, ban_days, by_series
from .schemas import (
    BanInterval,
    HabForecast,
    HabIndexValue,
    HabRiskRequest,
    HabRiskResponse,
    RedTideEvent,
)

router = APIRouter(prefix="/hab", tags=["hab"])

MAX_WINDOW_DAYS = 366
JST = ZoneInfo("Asia/Tokyo")


def _season(season: str) -> tuple[date, date]:
    """A HAB season is the calendar year (restrictions run across the fiscal-year boundary)."""
    if not (len(season) == 4 and season.isdigit()):
        raise HTTPException(422, detail="season must be YYYY")
    y = int(season)
    return date(y, 1, 1), date(y, 12, 31)


def _today() -> date:
    """Open restrictions run to today in JST, the bulletins' time zone."""
    return datetime.now(JST).date()


def _indices(zone: str | None, species: list[str], start: date, end: date) -> list[HabIndexValue]:
    if zone is None:
        return []
    out: list[HabIndexValue] = []
    for sp in species:
        for d in ban_days(bans.zone_bans(zone, start, end, sp), start, end, _today()):
            common = {"as_of": d.day, "source": d.source, "species": d.species, "toxin": d.toxin}
            out.append(HabIndexValue(index="BANWEEKS", unit=BANWEEKS_UNIT, value=d.banweeks, **common))
            out.append(HabIndexValue(index="BAN_ACTIVE", unit=BAN_ACTIVE_UNIT, value=d.active, **common))
    return out


@router.post("/risk", response_model=HabRiskResponse)
def risk(req: HabRiskRequest) -> HabRiskResponse:
    """GeoJSON Feature + species + date range -> BANWEEKS / BAN_ACTIVE per day, inherited from the plot's sea area.

    Days outside every published restriction are omitted. A plot outside every monitored sea area gets no indices.
    """
    if req.end < req.start:
        raise HTTPException(422, detail="end is before start")
    if (req.end - req.start).days >= MAX_WINDOW_DAYS:
        raise HTTPException(422, detail=f"window is longer than {MAX_WINDOW_DAYS} days")
    geom = shape(req.feature.geometry.model_dump())
    zone = sea_area_of(geom)
    return HabRiskResponse(
        module=MODULE,
        module_version=MODULE_VERSION,
        plot=store.summary(geom, sea_area=zone),
        window=Window(start=req.start, end=req.end),
        indices=_indices(zone, [req.species], req.start, req.end),
    )


@router.get("/plots/{plot}/risk", response_model=HabRiskResponse)
def plot_risk(plot: str, season: str) -> HabRiskResponse:
    """HAB indices for an inventoried plot over a season (the calendar year), for each of its species."""
    start, end = _season(season)
    if (p := store.lookup(plot)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"unknown plot {plot!r}")
    return HabRiskResponse(
        module=MODULE,
        module_version=MODULE_VERSION,
        plot=store.summary(p.geometry, p.plot_code, p.sea_area),
        window=Window(start=start, end=end),
        indices=_indices(p.sea_area, list(p.species), start, end),
    )


@router.get("/indices/{zone}/{season}", response_model=IndicesResponse)
def indices(zone: str, season: str) -> IndicesResponse:
    """Per-day BANWEEKS and BAN_ACTIVE for a sea area, one series per species and toxin with a published restriction."""
    start, end = _season(season)
    if sea_area(zone) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"unknown sea area {zone!r}")
    series: list[IndexSeries] = []
    for (sp, toxin), days in sorted(
        by_series(ban_days(bans.zone_bans(zone, start, end), start, end, _today())).items()
    ):
        for index, unit, value in (("BANWEEKS", BANWEEKS_UNIT, "banweeks"), ("BAN_ACTIVE", BAN_ACTIVE_UNIT, "active")):
            series.append(
                IndexSeries(
                    index=index,
                    unit=unit,
                    species=sp,
                    toxin=toxin,
                    points=[IndexPoint(date=d.day, value=getattr(d, value), source=d.source) for d in days],
                )
            )
    return IndicesResponse(module=MODULE, module_version=MODULE_VERSION, zone=zone, season=season, series=series)


@router.get("/bans", response_model=list[BanInterval])
def list_bans(season: str, pref: str | None = None) -> list[BanInterval]:
    """Normalized shellfish toxin restrictions in force at any time during the season (the calendar year)."""
    start, end = _season(season)
    return bans.bans(start, end, pref)


@router.get("/redtides", response_model=list[RedTideEvent])
@stub
def redtides(season: str, pref: str | None = None) -> list[RedTideEvent]:
    """Normalized red-tide events."""
    raise not_implemented("GET /hab/redtides")


@router.get("/forecast/{zone}", response_model=HabForecast)
@stub
def forecast(zone: str) -> HabForecast:
    """hab-onset probabilities (advisory)."""
    raise not_implemented("GET /hab/forecast/{zone}")


@router.get("/layers/{day}", response_model=list[LayerInfo])
def layers(day: date) -> list[LayerInfo]:
    """Chlorophyll-a layers covering a date: the daily SGLI layer and the monthly composite containing it."""
    return layers_on(MODULE, day)


add_tile_route(router, MODULE)
