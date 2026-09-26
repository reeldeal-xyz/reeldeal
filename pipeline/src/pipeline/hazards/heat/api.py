"""Heat router (README §6). Serves precomputed layers and indices from `out/heat/`; no satellite calls per request."""

from datetime import date

from fastapi import APIRouter, HTTPException, status
from shapely.geometry import shape

from pipeline.core.errors import not_implemented, stub
from pipeline.core.layers import layers_on
from pipeline.core.plots import store
from pipeline.core.regions import sea_area
from pipeline.core.schemas import IndicesResponse, LayerInfo

from . import MODULE
from .build import NotBuilt, read_plot_risk, read_zone_indices
from .build import risk as compute_risk
from .layers import season_window
from .schemas import HeatClimatology, HeatForecast, HeatRiskRequest, HeatRiskResponse

router = APIRouter(prefix="/heat", tags=["heat"])

MAX_WINDOW_DAYS = 366


def _season(season: str) -> str:
    try:
        season_window(season)
    except ValueError as e:
        raise HTTPException(422, detail=str(e)) from None
    return season


def _not_built(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{what} has not been built yet (see `pipeline heat build`)")


@router.post("/risk", response_model=HeatRiskResponse)
def risk(req: HeatRiskRequest) -> HeatRiskResponse:
    """GeoJSON Feature + date range (+ t) -> heat indices per day, with the product and pixels behind each value.

    Samples the precomputed layers. Days with no built layer are omitted; a null value means no valid pixel in reach.
    """
    if req.end < req.start:
        raise HTTPException(422, detail="end is before start")
    if (req.end - req.start).days >= MAX_WINDOW_DAYS:
        raise HTTPException(422, detail=f"window is longer than {MAX_WINDOW_DAYS} days")
    try:
        return compute_risk(shape(req.feature.geometry.model_dump()), req.start, req.end, req.t)
    except NotBuilt as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(e)) from None


@router.get("/plots/{plot}/risk", response_model=HeatRiskResponse)
def plot_risk(plot: str, season: str) -> HeatRiskResponse:
    """Heat indices for an inventoried plot over its season (06-01..10-31)."""
    if store.get(plot) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"unknown plot {plot!r}")
    if (resp := read_plot_risk(plot, _season(season))) is None:
        raise _not_built(f"heat season {season} for plot {plot}")
    return resp


@router.get("/indices/{zone}/{season}", response_model=IndicesResponse)
def indices(zone: str, season: str) -> IndicesResponse:
    """Per-day heat indices for a sea area over its season (06-01..10-31)."""
    if sea_area(zone) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"unknown sea area {zone!r}")
    if (resp := read_zone_indices(zone, _season(season))) is None:
        raise _not_built(f"heat season {season} for {zone}")
    return resp


@router.get("/forecast/{plot}", response_model=HeatForecast)
@stub
def forecast(plot: str) -> HeatForecast:
    """heat-forecast values (advisory)."""
    raise not_implemented("GET /heat/forecast/{plot}")


@router.get("/layers/{day}", response_model=list[LayerInfo])
def layers(day: date) -> list[LayerInfo]:
    """SST layers covering a date: that day's per-product layers, the COBE normal and the monthly composite."""
    return layers_on(MODULE, day)


@router.get("/climatology/{zone}", response_model=HeatClimatology)
@stub
def climatology(zone: str) -> HeatClimatology:
    """SST trend and marine heatwave statistics."""
    raise not_implemented("GET /heat/climatology/{zone}")
