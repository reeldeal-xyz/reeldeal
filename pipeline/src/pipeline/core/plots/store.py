"""Plot inventory (README §3).

Plots carry code, geometry, species, operation and sea area only. No owner names or personal data.

Two sources: the reviewed seed in `data/ref/plots.geojson` (served without a database) and the live PostGIS
inventory in `geo.plots`. When the database is reachable, its rows are authoritative for matching plot codes;
this is how the HMI receives the fishery-right polygons that replaced the old p1213-* seed discs. When the
database is unset, local development falls back to the reviewed seed. A configured but unavailable database fails closed.
"""

import json
import math
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from shapely.geometry import box, shape
from shapely.geometry.base import BaseGeometry

from pipeline.core.config import ref_dir
from pipeline.core.regions import sea_area_of
from pipeline.core.schemas import PlotSummary

KM_PER_DEG = 111.32


@dataclass(frozen=True)
class PlotRecord:
    plot_code: str
    geometry: BaseGeometry
    geojson: dict
    species: tuple[str, ...]
    operation: str | None
    sea_area: str | None
    prefecture: str | None
    source: str
    centroid_value: tuple[float, float] | None = None
    area_m2_value: float | None = None

    @property
    def centroid(self) -> tuple[float, float]:
        if self.centroid_value is not None:
            return self.centroid_value
        c = self.geometry.centroid
        return (round(c.x, 6), round(c.y, 6))

    @property
    def area_m2(self) -> float:
        return self.area_m2_value if self.area_m2_value is not None else area_m2(self.geometry)


def area_m2(geom: BaseGeometry) -> float:
    """Area of a lon/lat geometry in m² (local equirectangular)."""
    k = (KM_PER_DEG * 1000) ** 2 * math.cos(math.radians(geom.centroid.y))
    return round(geom.area * k, 1)


def summary(geom: BaseGeometry, plot_code: str | None = None, sea_area: str | None = None) -> PlotSummary:
    """The plot as echoed in a module response."""
    c = geom.centroid
    return PlotSummary(
        plot_code=plot_code,
        area_m2=area_m2(geom),
        centroid=(round(c.x, 6), round(c.y, 6)),
        sea_area=sea_area or sea_area_of(geom),
    )


def _record(f: dict) -> PlotRecord:
    p = f["properties"]
    geom = shape(f["geometry"])
    return PlotRecord(
        plot_code=p["plotCode"],
        geometry=geom,
        geojson=f["geometry"],
        species=tuple(p.get("species") or ()),
        operation=p["operation"],
        sea_area=p.get("seaArea") or sea_area_of(geom),
        prefecture=p.get("prefecture"),
        source=p.get("source", "demo"),
    )


@cache
def _load(path: Path, mtime_ns: int) -> dict[str, PlotRecord]:
    return {r.plot_code: r for r in map(_record, json.loads(path.read_text())["features"])}


def plots() -> dict[str, PlotRecord]:
    path = ref_dir() / "plots.geojson"
    return _load(path, path.stat().st_mtime_ns) if path.exists() else {}


def get(plot_code: str) -> PlotRecord | None:
    return plots().get(plot_code)


def query(bbox: tuple[float, float, float, float] | None = None, species: str | None = None) -> list[PlotRecord]:
    area = box(*bbox) if bbox else None
    return [
        p
        for p in sorted(plots().values(), key=lambda p: p.plot_code)
        if (area is None or area.intersects(p.geometry)) and (species is None or species in p.species)
    ]


def lookup(plot_code: str) -> PlotRecord | None:
    """Current DB plot when reachable; reviewed seed only as a fallback."""
    from pipeline.core import db

    from . import inventory

    try:
        return inventory.get(plot_code)
    except db.NoDatabase:
        if db.configured():
            raise
        return get(plot_code)


def query_all(bbox: tuple[float, float, float, float] | None = None, species: str | None = None) -> list[PlotRecord]:
    """Current DB inventory; seed only for explicitly DB-less local development."""
    from pipeline.core import db

    from . import inventory

    try:
        return inventory.query(bbox, species)
    except db.NoDatabase:
        if db.configured():
            raise
        return query(bbox, species)
