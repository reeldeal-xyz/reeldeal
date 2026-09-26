"""FastAPI app: shared core routes + the three module routers (README §11)."""

import os
from collections.abc import Iterable

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from starlette.routing import BaseRoute

from pipeline import __version__
from pipeline.core.errors import is_stub, not_implemented, stub
from pipeline.core.plots import store
from pipeline.core.regions import sea_areas
from pipeline.core.schemas import (
    Health,
    HealthStatus,
    Model,
    ModuleHealth,
    ModuleName,
    Plot,
    PlotCreate,
    PlotSummary,
    RiskRequest,
    RouteCounts,
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


def _route_counts(routes: Iterable[BaseRoute]) -> RouteCounts:
    endpoints = [r.endpoint for r in routes if isinstance(r, APIRoute)]
    return RouteCounts(implemented=sum(not is_stub(e) for e in endpoints), total=len(endpoints))


def _status(counts: RouteCounts) -> HealthStatus:
    if counts.implemented == counts.total:
        return "ok"
    return "unimplemented" if counts.implemented == 0 else "degraded"


def _bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    if bbox is None:
        return None
    try:
        west, south, east, north = (float(v) for v in bbox.split(","))
    except ValueError:
        raise HTTPException(422, detail="bbox must be west,south,east,north") from None
    if west >= east or south >= north:
        raise HTTPException(422, detail="bbox must be west,south,east,north") from None
    return west, south, east, north


def _plot(p: store.PlotRecord) -> Plot:
    return Plot(
        plot_code=p.plot_code,
        geometry=p.geojson,
        species=list(p.species),
        operation=p.operation,
        sea_area=p.sea_area,
        prefecture=p.prefecture,
        area_m2=p.area_m2,
        centroid=p.centroid,
        source=p.source,
    )


def core_router(modules: Iterable[ModuleName]) -> APIRouter:
    modules = list(modules)
    router = APIRouter(tags=["core"])

    @router.get("/health", response_model=Health)
    def health(request: Request) -> Health:
        """Status and version of each mounted module, and the deployed commit.

        Always 200 while the process is up (it backs the Docker healthcheck). `status` says how much of the
        API is implemented: routes that still return 501 make it `degraded` or `unimplemented`, never `ok`.
        """
        routes = (r for rt in request.app.state.routers for r in rt.routes if getattr(r, "path", None) != "/health")
        app_counts = _route_counts(routes)
        module_health = {}
        for m in modules:
            counts = _route_counts(MODULES[m][0].routes)
            module_health[m] = ModuleHealth(status=_status(counts), module_version=MODULES[m][1], routes=counts)
        return Health(
            status=_status(app_counts),
            version=__version__,
            commit=os.environ.get("GIT_SHA") or None,
            routes=app_counts,
            modules=module_health,
        )

    @router.get("/plots", response_model=list[Plot])
    def list_plots(bbox: str | None = None, species: Species | None = None) -> list[Plot]:
        """Plot inventory (no personal data). bbox = west,south,east,north."""
        return [_plot(p) for p in store.query(_bbox(bbox), species)]

    @router.post("/plots", response_model=Plot, status_code=201)
    @stub
    def create_plot(plot: PlotCreate) -> Plot:
        """Register / upload a plot polygon. Waits on the PostGIS service that will hold plots."""
        raise not_implemented("POST /plots")

    @router.get("/stations", response_model=list[Station])
    @stub
    def list_stations(bbox: str | None = None, type: StationType | None = None) -> list[Station]:
        """Station registry."""
        raise not_implemented("GET /stations")

    @router.get("/stations/{station_id}/series", response_model=StationSeries)
    @stub
    def station_series(station_id: str, var: str) -> StationSeries:
        """Station observations."""
        raise not_implemented("GET /stations/{id}/series")

    @router.get("/zones", response_model=list[Zone])
    def list_zones() -> list[Zone]:
        """Sea areas: the prefectures' toxin / red-tide monitoring areas (approximate traced polygons)."""
        return [
            Zone(id=a.id, name=a.name, name_ja=a.name_ja, prefecture=a.prefecture, geometry=a.geojson)
            for a in sorted(sea_areas().values(), key=lambda a: a.id)
        ]

    if set(modules) == set(MODULES):

        @router.post("/risk", response_model=CombinedRisk)
        @stub
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
    # Kept on app.state because FastAPI doesn't expose included routes as APIRoutes in app.routes (/health counts them).
    app.state.routers = [core_router(modules), *(MODULES[m][0] for m in modules)]
    for router in app.state.routers:
        app.include_router(router)
    return app


app = create_app()
