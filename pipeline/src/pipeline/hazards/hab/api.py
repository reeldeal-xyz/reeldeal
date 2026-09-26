"""HAB router (README §7). Routes are defined; analysis is not implemented yet."""

from datetime import date

from fastapi import APIRouter

from pipeline.core.errors import not_implemented
from pipeline.core.schemas import IndicesResponse, LayerInfo

from .schemas import BanInterval, HabForecast, HabRiskRequest, HabRiskResponse, RedTideEvent

router = APIRouter(prefix="/hab", tags=["hab"])


@router.post("/risk", response_model=HabRiskResponse)
def risk(req: HabRiskRequest) -> HabRiskResponse:
    """GeoJSON Feature + species + date range -> HAB indices, sources."""
    raise not_implemented("POST /hab/risk")


@router.get("/plots/{plot}/risk", response_model=HabRiskResponse)
def plot_risk(plot: str, season: str) -> HabRiskResponse:
    """HAB indices for an inventoried plot (inherited from its sea area)."""
    raise not_implemented("GET /hab/plots/{plot}/risk")


@router.get("/indices/{zone}/{season}", response_model=IndicesResponse)
def indices(zone: str, season: str) -> IndicesResponse:
    """Per-day ban / red-tide indices for a sea area."""
    raise not_implemented("GET /hab/indices/{zone}/{season}")


@router.get("/bans", response_model=list[BanInterval])
def bans(season: str, pref: str | None = None) -> list[BanInterval]:
    """Normalized shellfish toxin restrictions."""
    raise not_implemented("GET /hab/bans")


@router.get("/redtides", response_model=list[RedTideEvent])
def redtides(season: str, pref: str | None = None) -> list[RedTideEvent]:
    """Normalized red-tide events."""
    raise not_implemented("GET /hab/redtides")


@router.get("/forecast/{zone}", response_model=HabForecast)
def forecast(zone: str) -> HabForecast:
    """hab-onset probabilities (advisory)."""
    raise not_implemented("GET /hab/forecast/{zone}")


@router.get("/layers/{day}", response_model=list[LayerInfo])
def layers(day: date) -> list[LayerInfo]:
    """Chlorophyll-a layer metadata / tile URL."""
    raise not_implemented("GET /hab/layers/{date}")
