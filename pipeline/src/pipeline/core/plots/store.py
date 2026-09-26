"""Plot inventory (README §3), read-only.

Plots carry code, geometry, species, operation and sea area only. No owner names or personal data.

Spatial data is moving to a separate PostGIS service that the pipeline reads as a client (decided 2026-09-26).
Until that service exists, the inventory is the reviewed seed in `data/ref/plots.geojson` (the Kesennuma demo
plots), and uploads (`POST /plots`) stay unimplemented. Swapping the backend only changes this module.
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
