"""Build regions and sea areas (README §1, §3).

A region is the bounding box a build runs over. Sea areas are the prefectures' toxin / red-tide monitoring
areas, loaded from the reviewed polygons in `data/ref/zones/*.geojson`.
"""

import json
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

from pipeline.core.config import ref_dir

BBox = tuple[float, float, float, float]  # west, south, east, north (EPSG:4326)


@dataclass(frozen=True)
class Region:
    id: str
    name: str
    bbox: BBox


REGIONS: dict[str, Region] = {
    # Demo and regression region: the Miyagi coast from the Iwate border to Sendai Bay.
    "miyagi": Region("miyagi", "Miyagi coast", (140.8, 37.7, 142.0, 39.1)),
    # National coverage (§3). Needs the coastal mask (Q8) before daily builds are practical at SGLI resolution.
    "japan": Region("japan", "Coastal Japan", (122.0, 24.0, 149.0, 46.0)),
}


def region(region_id: str) -> Region:
    try:
        return REGIONS[region_id]
    except KeyError:
        raise ValueError(f"unknown region {region_id!r}; known: {', '.join(REGIONS)}") from None


@dataclass(frozen=True)
class SeaArea:
    id: str
    name: str
    name_ja: str | None
    prefecture: str
    geometry: BaseGeometry
    geojson: dict
    properties: dict


def _zones_dir() -> Path:
    return ref_dir() / "zones"


def _split_name(name: str) -> tuple[str, str | None]:
    """'唐桑半島東部 (Karakuwa Peninsula East)' -> ('Karakuwa Peninsula East', '唐桑半島東部')."""
    if m := re.fullmatch(r"\s*(.+?)\s*\((.+)\)\s*", name):
        return m.group(2), m.group(1)
    return name, None


@cache
def _load_sea_areas(zones_dir: Path) -> dict[str, SeaArea]:
    areas: dict[str, SeaArea] = {}
    for path in sorted(zones_dir.glob("*.geojson")):
        doc = json.loads(path.read_text())
        features = doc["features"] if doc.get("type") == "FeatureCollection" else [doc]
        for f in features:
            props = f.get("properties") or {}
            zone_id = props.get("zone") or path.stem
            name, name_ja = _split_name(props.get("name", zone_id))
            areas[zone_id] = SeaArea(
                id=zone_id,
                name=name,
                name_ja=name_ja,
                prefecture=props.get("prefecture", "miyagi"),
                geometry=shape(f["geometry"]),
                geojson=f["geometry"],
                properties=props,
            )
    return areas


def sea_areas() -> dict[str, SeaArea]:
    return _load_sea_areas(_zones_dir())


def sea_area(zone_id: str) -> SeaArea | None:
    return sea_areas().get(zone_id)


def sea_area_of(geom: BaseGeometry) -> str | None:
    """The sea area containing (or, failing that, nearest to) a plot, within ~5 km."""
    areas = sea_areas()
    if not areas:
        return None
    centroid = geom.centroid
    for a in areas.values():
        if a.geometry.contains(centroid):
            return a.id
    nearest = min(areas.values(), key=lambda a: a.geometry.distance(centroid))
    return nearest.id if nearest.geometry.distance(centroid) < 0.05 else None
