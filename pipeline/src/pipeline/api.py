"""FastAPI app: shared core routes + the three module routers (README §11)."""

from collections.abc import Iterable

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pipeline import __version__
from pipeline.core.errors import not_implemented
from pipeline.core.schemas import (
    Health,
    Model,
    ModuleHealth,
    ModuleName,
    Plot,
    PlotCreate,
    PlotSummary,
    RiskRequest,
    Species,
    Station,
    StationSeries,
    StationType,
    Zone,
)
from pipeline.hazards import hab, heat, storm
from pipeline.hazards.hab.api import router as hab_router
from pipeline.hazards.hab.schemas import HabRiskResponse
from pipeline.hazards.heat.api import router as heat_router
from pipeline.hazards.heat.schemas import HeatRiskResponse
from pipeline.hazards.storm.api import router as storm_router
from pipeline.hazards.storm.schemas import StormRiskResponse

MODULES: dict[ModuleName, tuple[APIRouter, str]] = {
    "heat": (heat_router, heat.MODULE_VERSION),
    "hab": (hab_router, hab.MODULE_VERSION),
    "storm": (storm_router, storm.MODULE_VERSION),
}


class CombinedRisk(Model):
    """POST /risk: the three module responses merged, with no logic of its own."""

    plot: PlotSummary
    heat: HeatRiskResponse | None
    hab: HabRiskResponse | None
    storm: StormRiskResponse | None


def core_router(modules: Iterable[ModuleName]) -> APIRouter:
    modules = list(modules)
    router = APIRouter(tags=["core"])

    @router.get("/health", response_model=Health)
    def health() -> Health:
        """Status and version of each mounted module."""
        return Health(
            status="ok",
            version=__version__,
            modules={m: ModuleHealth(status="ok", module_version=MODULES[m][1]) for m in modules},
        )

    @router.get("/plots", response_model=list[Plot])
    def list_plots(bbox: str | None = None, species: Species | None = None) -> list[Plot]:
        """Plot inventory (no personal data). bbox = west,south,east,north."""
        raise not_implemented("GET /plots")

    @router.post("/plots", response_model=Plot, status_code=201)
    def create_plot(plot: PlotCreate) -> Plot:
        """Register / upload a plot polygon."""
        raise not_implemented("POST /plots")

    @router.get("/stations", response_model=list[Station])
    def list_stations(bbox: str | None = None, type: StationType | None = None) -> list[Station]:
        """Station registry."""
        raise not_implemented("GET /stations")

    @router.get("/stations/{station_id}/series", response_model=StationSeries)
    def station_series(station_id: str, var: str) -> StationSeries:
        """Station observations."""
        raise not_implemented("GET /stations/{id}/series")

    @router.get("/zones", response_model=list[Zone])
    def list_zones() -> list[Zone]:
        """Sea areas."""
        raise not_implemented("GET /zones")

    if set(modules) == set(MODULES):

        @router.post("/risk", response_model=CombinedRisk)
        def combined_risk(req: RiskRequest) -> CombinedRisk:
            """Calls /heat/risk, /hab/risk, /storm/risk and merges them."""
            raise not_implemented("POST /risk")

    return router


def create_app(modules: Iterable[ModuleName] = MODULES) -> FastAPI:
    modules = list(modules)
    app = FastAPI(
        title="Aquaculture risk pipeline",
        version=__version__,
        description="Risk index values for aquaculture plots and sea areas in coastal Japan. "
        "Index values only: no thresholds, statuses or payout decisions.",
    )
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.include_router(core_router(modules))
    for m in modules:
        app.include_router(MODULES[m][0])
    return app


app = create_app()
