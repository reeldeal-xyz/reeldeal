"""Storm router (README §8). Routes are defined; analysis is not implemented yet."""

from datetime import date

from fastapi import APIRouter

from pipeline.core.errors import not_implemented, stub
from pipeline.core.schemas import IndicesResponse, LayerInfo

from .schemas import StormEvent, StormForecast, StormImpact, StormRiskRequest, StormRiskResponse

router = APIRouter(prefix="/storm", tags=["storm"])


@router.post("/risk", response_model=StormRiskResponse)
@stub
def risk(req: StormRiskRequest) -> StormRiskResponse:
    """GeoJSON Feature + gear + date range (+ h) -> storm indices, station/pixels used, sources."""
    raise not_implemented("POST /storm/risk")


@router.get("/plots/{plot}/risk", response_model=StormRiskResponse)
@stub
def plot_risk(plot: str, season: str) -> StormRiskResponse:
    """Storm indices for an inventoried plot."""
    raise not_implemented("GET /storm/plots/{plot}/risk")


@router.get("/events", response_model=list[StormEvent])
@stub
def events(season: str) -> list[StormEvent]:
    """Storm event catalogue (typhoons, extratropical storms)."""
    raise not_implemented("GET /storm/events")


@router.get("/events/{event}/impact", response_model=StormImpact)
@stub
def event_impact(event: str) -> StormImpact:
    """Per-sea-area storm indices for one event."""
    raise not_implemented("GET /storm/events/{event}/impact")


@router.get("/indices/{zone}/{season}", response_model=IndicesResponse)
@stub
def indices(zone: str, season: str) -> IndicesResponse:
    """Per-day and per-event storm indices for a sea area."""
    raise not_implemented("GET /storm/indices/{zone}/{season}")


@router.get("/forecast/{plot}", response_model=StormForecast)
@stub
def forecast(plot: str) -> StormForecast:
    """storm-nowcast / storm-damage values (advisory)."""
    raise not_implemented("GET /storm/forecast/{plot}")


@router.get("/layers/{day}", response_model=list[LayerInfo])
@stub
def layers(day: date) -> list[LayerInfo]:
    """Surge / Hs layer metadata / tile URL."""
    raise not_implemented("GET /storm/layers/{date}")
