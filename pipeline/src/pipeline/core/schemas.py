"""Shared pydantic models: plots, sea areas, stations and the module response envelope (README §3, §5, §11).

JSON field names are camelCase, except `module_version` and `model_version`, which the spec keeps snake_case.
No personal data: plots carry code, geometry, species and operation only.
"""

from datetime import date, datetime
from typing import Literal

from geojson_pydantic import Feature, MultiPolygon, Polygon
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

ModuleName = Literal["heat", "hab", "storm"]

# Q4: species / operation list is still open.
Species = Literal[
    "nori",
    "wakame",
    "kombu",
    "scallop",
    "oyster",
    "hoya",
    "yellowtail",
    "sea_bream",
    "coho_salmon",
    "bluefin_tuna",
]
Operation = Literal["longline", "raft", "cage"]

# §3 pixel extraction order; `tide_station` is storm surge only.
ExtractionStrategy = Literal["inside", "buffer_500m", "buffer_2km", "nearest_pixel", "tide_station"]

StationType = Literal["buoy", "tide", "shore", "research"]

PlotGeometry = Polygon | MultiPolygon
PlotFeature = Feature[PlotGeometry, dict | None]


class Model(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


# --- plots and sea areas ---------------------------------------------------


class PlotSummary(Model):
    """The plot as echoed in a module response."""

    plot_code: str | None = None
    area_m2: float
    centroid: tuple[float, float] = Field(description="[lon, lat], EPSG:4326")
    sea_area: str | None = None


class Plot(Model):
    plot_code: str
    geometry: PlotGeometry
    species: list[Species]
    operation: Operation
    sea_area: str | None = None
    prefecture: str | None = None
    area_m2: float
    centroid: tuple[float, float]
    source: Literal["msil", "upload"]


class PlotCreate(Model):
    """POST /plots body. No owner names or personal data."""

    plot_code: str
    geometry: PlotGeometry
    species: list[Species]
    operation: Operation


class Zone(Model):
    """A prefecture's toxin / red-tide monitoring sea area."""

    id: str = Field(examples=["miyagi-kesennuma"])
    name: str
    name_ja: str | None = None
    prefecture: str
    geometry: PlotGeometry | None = None


# --- stations ----------------------------------------------------------------


class Station(Model):
    station_id: str
    name: str
    source: str
    type: StationType
    lat: float
    lon: float
    prefecture: str | None = None
    sea_area: str | None = None
    variables: list[str]
    cadence: str = Field(examples=["PT1H"])
    url: str | None = None
    first_obs: datetime | None = None
    last_obs: datetime | None = None


class StationPoint(Model):
    t: datetime
    value: float | None


class StationSeries(Model):
    station_id: str
    var: str
    unit: str
    points: list[StationPoint]


# --- index envelope ------------------------------------------------------------


class Window(Model):
    start: date
    end: date


class Source(Model):
    product: str
    sha256: str


class Pixels(Model):
    strategy: ExtractionStrategy
    count: int
    product: str
    station_id: str | None = Field(default=None, description="Set when strategy is tide_station")


class IndexValue(Model):
    """One observed index value. Modules narrow `index` to their own names."""

    index: str
    unit: str
    value: float | None = Field(description="null when no valid input (e.g. cloud)")
    as_of: date
    source: Source


class AdvisoryValue(Model):
    """A model output. Always carries model_version; never mixed with observed indices."""

    index: str
    horizon_days: int
    value: float
    p10: float | None = None
    p90: float | None = None
    model_version: str = Field(alias="model_version")


class RiskEnvelope(Model):
    """Common response of POST /<module>/risk."""

    module: ModuleName
    module_version: str = Field(alias="module_version")
    plot: PlotSummary
    window: Window
    pixels: Pixels | None = None
    indices: list[IndexValue]
    advisory: list[AdvisoryValue] = []


class IndexPoint(Model):
    date: date
    value: float | None


class IndexSeries(Model):
    index: str
    unit: str
    source: Source
    points: list[IndexPoint]


class IndicesResponse(Model):
    """GET /<module>/indices/{zone}/{season}: per-day index series for a sea area."""

    module: ModuleName
    module_version: str = Field(alias="module_version")
    zone: str
    season: str
    series: list[IndexSeries]


class LayerInfo(Model):
    """GET /<module>/layers/{date}: metadata for one precomputed daily layer."""

    module: ModuleName
    date: date
    product: str
    variable: str
    unit: str
    bbox: tuple[float, float, float, float] = Field(description="[west, south, east, north]")
    tile_url: str | None = None
    zarr_url: str | None = None
    sha256: str


# --- requests ------------------------------------------------------------------


class RiskRequestBase(Model):
    feature: PlotFeature
    start: date
    end: date


class RiskRequest(RiskRequestBase):
    """POST /risk: union of the three module requests; fans out and merges."""

    species: Species | None = None
    gear: Operation | None = None
    t: float | None = None
    h: float | None = None


# --- health ----------------------------------------------------------------------


# ok: every route is implemented. degraded: some routes still return 501. unimplemented: all of them do.
# A 501 means "not supported yet", never "healthy" or "no risk" (#35).
HealthStatus = Literal["ok", "degraded", "unimplemented"]


class RouteCounts(Model):
    implemented: int
    total: int


class ModuleHealth(Model):
    status: HealthStatus
    module_version: str = Field(alias="module_version")
    routes: RouteCounts


class Health(Model):
    status: HealthStatus
    version: str
    commit: str | None = Field(None, description="Commit SHA of the deployed build (GIT_SHA); null when run from source")
    routes: RouteCounts
    modules: dict[ModuleName, ModuleHealth]
