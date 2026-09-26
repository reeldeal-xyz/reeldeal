"""HAB router (README §7). Chlorophyll-a layers are served; ban, red-tide and CHL indices are not implemented yet (#80)."""

from datetime import date

from fastapi import APIRouter

from pipeline.core.errors import not_implemented, stub
from pipeline.core.layers import layers_on
from pipeline.core.schemas import IndicesResponse, LayerInfo

from . import MODULE
from .schemas import (
    BanInterval,
    HabForecast,
    HabRiskRequest,
    HabRiskResponse,
    RedTideEvent,
)

router = APIRouter(prefix="/hab", tags=["hab"])


@router.post("/risk", response_model=HabRiskResponse)
@stub
def risk(req: HabRiskRequest) -> HabRiskResponse:
    """GeoJSON Feature + species + date range -> HAB indices, sources."""
    raise not_implemented("POST /hab/risk")


@router.get("/plots/{plot}/risk", response_model=HabRiskResponse)
@stub
def plot_risk(plot: str, season: str) -> HabRiskResponse:
    """HAB indices for an inventoried plot (inherited from its sea area)."""
    raise not_implemented("GET /hab/plots/{plot}/risk")


@router.get("/indices/{zone}/{season}", response_model=IndicesResponse)
@stub
def indices(zone: str, season: str) -> IndicesResponse:
    """Per-day ban / red-tide indices for a sea area."""
    raise not_implemented("GET /hab/indices/{zone}/{season}")


@router.get("/bans", response_model=list[BanInterval])
@stub
def bans(season: str, pref: str | None = None) -> list[BanInterval]:
    """Normalized shellfish toxin restrictions."""
    raise not_implemented("GET /hab/bans")


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
