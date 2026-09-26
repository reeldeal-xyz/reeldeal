"""Plot inventory (README §3).

Plots carry code, geometry, species, operation and sea area only. No owner names or personal data.

Two sources: `geo.plots` in PostGIS (`uploads.py`: uploads, the loaded fishery rights and the demo plots with their
real zone polygons), and the reviewed seed in `data/ref/plots.geojson` (the Kesennuma demo plots as synthetic
rectangles). `lookup` and `query_all` read the database; when it is unset or down they fall back to the seed.
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
    operation: str
    sea_area: str | None
    prefecture: str | None
    source: str

    @property
    def centroid(self) -> tuple[float, float]:
        c = self.geometry.centroid
        return (round(c.x, 6), round(c.y, 6))

    @property
    def area_m2(self) -> float:
        return area_m2(self.geometry)


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
    """The plot from the database, or from the seed when the database is unavailable or lacks the code."""
    from pipeline.core import db

    from . import uploads

    try:
        if (p := uploads.get(plot_code)) is not None:
            return p
    except db.NoDatabase:
        pass
    return get(plot_code)


def query_all(bbox: tuple[float, float, float, float] | None = None, species: str | None = None) -> list[PlotRecord]:
    """Every live plot in the database; the seed alone while the database is unavailable."""
    from pipeline.core import db

    from . import uploads

    try:
        return uploads.query(bbox, species)
    except db.NoDatabase:
        return query(bbox, species)
