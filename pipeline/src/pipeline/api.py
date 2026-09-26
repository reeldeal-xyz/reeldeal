"""FastAPI app: shared core routes, species reference routes and the three module routers (README §11)."""

import os
from collections.abc import Callable, Iterable
from datetime import datetime

from fastapi import APIRouter, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from shapely.geometry import shape
from starlette.routing import BaseRoute

from pipeline import __version__
from pipeline.core import stations as station_store
from pipeline.core.db import NoDatabase
from pipeline.core.errors import is_stub
from pipeline.core.plots import store, uploads
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
from pipeline.hazards.hab import api as hab_api
from pipeline.hazards.hab.api import router as hab_router
from pipeline.hazards.hab.schemas import HabRiskRequest, HabRiskResponse
from pipeline.hazards.heat import api as heat_api
from pipeline.hazards.heat.api import router as heat_router
from pipeline.hazards.heat.schemas import HeatRiskRequest, HeatRiskResponse
from pipeline.hazards.storm import api as storm_api
from pipeline.hazards.storm.api import router as storm_router
from pipeline.hazards.storm.schemas import StormRiskRequest, StormRiskResponse
from pipeline.species.api import router as species_router

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


def _module(call: Callable[[], Model]) -> Model | None:
    """A module's response, or None when it has nothing to give: not built (404), not implemented (501) or its
    database is unavailable. Invalid input (422) still fails the whole request."""
    try:
        return call()
    except NoDatabase:
        return None
    except HTTPException as e:
        if e.status_code in (status.HTTP_404_NOT_FOUND, status.HTTP_501_NOT_IMPLEMENTED):
            return None
        raise


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
        """Plot inventory (no personal data): every live plot in the database. bbox = west,south,east,north.

        That covers uploads, the loaded fishery rights and the demo plots; while the database is unavailable only the
        reviewed seed is listed.
        """
        return [_plot(p) for p in store.query_all(_bbox(bbox), species)]

    @router.post("/plots", response_model=Plot, status_code=201)
    def create_plot(plot: PlotCreate) -> Plot:
        """Register a plot polygon (no personal data). Stored in PostGIS as `upload:<plotCode>`.

        409 if the code is taken, 422 for an invalid polygon, 503 while the database is unavailable.
        """
        geojson = plot.geometry.model_dump(exclude_none=True)
        geom = shape(geojson)
        if not geom.is_valid or geom.is_empty:
            raise HTTPException(422, detail="geometry is not a valid polygon")
        try:
            record = uploads.insert(plot.plot_code, geom, geojson, list(plot.species), plot.operation)
        except uploads.DuplicatePlot as e:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=str(e)) from None
        return _plot(record)

    @router.get("/stations", response_model=list[Station])
    def list_stations(bbox: str | None = None, type: StationType | None = None) -> list[Station]:
        """Station registry (buoys, tide gauges, shore and research stations). bbox = west,south,east,north."""
        return station_store.stations(_bbox(bbox), type)

    @router.get("/stations/{station_id}/series", response_model=StationSeries)
    def station_series(
        station_id: str,
        var: str,
        start: datetime | None = None,
        end: datetime | None = None,
        depth: float | None = None,
    ) -> StationSeries:
        """Observations of one variable (e.g. WT, water temperature), oldest first, with the pinned inputs behind them.

        A station measuring the variable at several depths needs `depth` (m).
        """
        try:
            return station_store.series(station_id, var, start, end, depth)
        except station_store.UnknownStation:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"unknown station {station_id!r}") from None
        except ValueError as e:
            raise HTTPException(422, detail=str(e)) from None

    @router.get("/zones", response_model=list[Zone])
    def list_zones() -> list[Zone]:
        """Sea areas: the prefectures' toxin / red-tide monitoring areas (approximate traced polygons)."""
        return [
            Zone(id=a.id, name=a.name, name_ja=a.name_ja, prefecture=a.prefecture, geometry=a.geojson)
            for a in sorted(sea_areas().values(), key=lambda a: a.id)
        ]

    if set(modules) == set(MODULES):

        @router.post("/risk", response_model=CombinedRisk)
        def combined_risk(req: RiskRequest) -> CombinedRisk:
            """Calls /heat/risk, /hab/risk and /storm/risk and merges them; no logic of its own.

            A module is null when its required field is missing (`species` for HAB, `gear` for storm) or when it has
            nothing to give: not built, not implemented yet, or its database is unavailable.
            """
            base = {"feature": req.feature, "start": req.start, "end": req.end}
            return CombinedRisk(
                plot=store.summary(shape(req.feature.geometry.model_dump())),
                heat=_module(lambda: heat_api.risk(HeatRiskRequest(**base, t=req.t))),
                hab=_module(lambda: hab_api.risk(HabRiskRequest(**base, species=req.species))) if req.species else None,
                storm=_module(lambda: storm_api.risk(StormRiskRequest(**base, gear=req.gear, h=req.h))) if req.gear else None,
            )

    return router


def create_app(modules: Iterable[ModuleName] = MODULES) -> FastAPI:
    modules = list(modules)
    app = FastAPI(
        title="Aquaculture risk pipeline",
        version=__version__,
        description="Risk index values for aquaculture plots and sea areas in coastal Japan. "
        "Index values and species reference data: no statuses or payout decisions; rules are served, never evaluated.",
    )
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(NoDatabase)
    def no_database(request: Request, exc: NoDatabase) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

    # Kept on app.state because FastAPI doesn't expose included routes as APIRoutes in app.routes (/health counts them).
    app.state.routers = [core_router(modules), species_router, *(MODULES[m][0] for m in modules)]
    for router in app.state.routers:
        app.include_router(router)
    return app


app = create_app()
