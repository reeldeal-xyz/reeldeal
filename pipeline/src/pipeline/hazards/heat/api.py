"""Heat router (README §6). Routes are defined; analysis is not implemented yet."""

from datetime import date

from fastapi import APIRouter

from pipeline.core.errors import not_implemented, stub
from pipeline.core.schemas import IndicesResponse, LayerInfo

from .schemas import HeatClimatology, HeatForecast, HeatRiskRequest, HeatRiskResponse

router = APIRouter(prefix="/heat", tags=["heat"])


@router.post("/risk", response_model=HeatRiskResponse)
@stub
def risk(req: HeatRiskRequest) -> HeatRiskResponse:
    """GeoJSON Feature + date range (+ t) -> heat indices, pixels used, sources."""
    raise not_implemented("POST /heat/risk")


@router.get("/plots/{plot}/risk", response_model=HeatRiskResponse)
@stub
def plot_risk(plot: str, season: str) -> HeatRiskResponse:
    """Heat indices for an inventoried plot."""
    raise not_implemented("GET /heat/plots/{plot}/risk")


@router.get("/indices/{zone}/{season}", response_model=IndicesResponse)
@stub
def indices(zone: str, season: str) -> IndicesResponse:
    """Per-day heat indices for a sea area."""
    raise not_implemented("GET /heat/indices/{zone}/{season}")


@router.get("/forecast/{plot}", response_model=HeatForecast)
@stub
def forecast(plot: str) -> HeatForecast:
    """heat-forecast values (advisory)."""
    raise not_implemented("GET /heat/forecast/{plot}")


@router.get("/layers/{day}", response_model=list[LayerInfo])
@stub
def layers(day: date) -> list[LayerInfo]:
    """SST layer metadata / tile URL."""
    raise not_implemented("GET /heat/layers/{date}")


@router.get("/climatology/{zone}", response_model=HeatClimatology)
@stub
def climatology(zone: str) -> HeatClimatology:
    """SST trend and marine heatwave statistics."""
    raise not_implemented("GET /heat/climatology/{zone}")
