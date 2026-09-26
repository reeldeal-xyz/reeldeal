"""Pixel extraction for a plot or sea-area polygon (README §3).

Plots are 10²–10³ m across and grids are 300 m–20 km, often masked inside bays, so extraction tries in order:

1. `inside`: pixels whose centre is inside the polygon;
2. `buffer_500m`, then `buffer_2km`: pixels inside the polygon buffered by that distance;
3. `nearest_pixel`: the nearest valid pixel to the centroid, within `nearest_max_km` (per product, because a
   cloud hole in a 300 m product and a coastal gap in a 20 km product need different reach).

The value is the median of the selected valid pixels. The strategy and pixel count are recorded with it.
(`tide_station`, the fourth option in §3, is storm surge only and lives in the storm module.)
"""

import math
from dataclasses import dataclass

import numpy as np
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from shapely import affinity
from shapely.geometry.base import BaseGeometry

from pipeline.core.grid import Grid
from pipeline.core.schemas import ExtractionStrategy

KM_PER_DEG_LAT = 111.32
BUFFERS_M: tuple[tuple[ExtractionStrategy, float], ...] = (("buffer_500m", 500.0), ("buffer_2km", 2000.0))


def buffer_m(geom: BaseGeometry, metres: float) -> BaseGeometry:
    """Buffer a lon/lat geometry by a distance in metres (local equirectangular; fine at plot scale)."""
    c = geom.centroid
    kx = KM_PER_DEG_LAT * 1000 * math.cos(math.radians(c.y))
    ky = KM_PER_DEG_LAT * 1000
    local = affinity.scale(affinity.translate(geom, -c.x, -c.y), kx, ky, origin=(0, 0))
    back = affinity.scale(local.buffer(metres), 1 / kx, 1 / ky, origin=(0, 0))
    return affinity.translate(back, c.x, c.y)


@dataclass
class Extraction:
    strategy: ExtractionStrategy
    count: int
    value: float
    distance_km: float | None = None


class Extractor:
    """Masks for one geometry on one grid, reused across every daily layer of a build."""

    def __init__(self, geom: BaseGeometry, grid: Grid, nearest_max_km: float):
        self.grid = grid
        self.nearest_max_km = nearest_max_km
        reach_km = max(2.0, nearest_max_km) + grid.res * KM_PER_DEG_LAT
        lat = geom.centroid.y
        dx = reach_km / (KM_PER_DEG_LAT * math.cos(math.radians(lat)))
        dy = reach_km / KM_PER_DEG_LAT
        w, s, e, n = geom.bounds
        h, wd = grid.shape
        c0 = max(0, math.floor((w - dx - grid.west) / grid.res))
        c1 = min(wd, math.ceil((e + dx - grid.west) / grid.res))
        r0 = max(0, math.floor((grid.north - (n + dy)) / grid.res))
        r1 = min(h, math.ceil((grid.north - (s - dy)) / grid.res))
        self.window = (slice(r0, r1), slice(c0, c1))
        shape = (r1 - r0, c1 - c0)
        self.empty = shape[0] <= 0 or shape[1] <= 0
        if self.empty:
            return
        transform = from_origin(grid.west + c0 * grid.res, grid.north - r0 * grid.res, grid.res, grid.res)

        def mask(g: BaseGeometry) -> np.ndarray:
            return geometry_mask([g], out_shape=shape, transform=transform, invert=True, all_touched=False)

        self.masks: list[tuple[ExtractionStrategy, np.ndarray]] = [("inside", mask(geom))]
        self.masks += [(name, mask(buffer_m(geom, m))) for name, m in BUFFERS_M]
        lons, lats = grid.lonlat()
        c = geom.centroid
        xx, yy = np.meshgrid(lons[c0:c1], lats[r0:r1])
        self.dist_km = np.hypot((xx - c.x) * KM_PER_DEG_LAT * math.cos(math.radians(c.y)), (yy - c.y) * KM_PER_DEG_LAT)

    def extract(self, data: np.ndarray) -> Extraction | None:
        """Median of the first non-empty pixel set, or None if nothing valid is within reach."""
        if self.empty:
            return None
        sub = data[self.window]
        valid = ~np.isnan(sub)
        for name, m in self.masks:
            sel = m & valid
            if n := int(sel.sum()):
                return Extraction(name, n, float(np.median(sub[sel])))
        if not valid.any():
            return None
        d = np.where(valid, self.dist_km, np.inf)
        i = np.unravel_index(np.argmin(d), d.shape)
        if d[i] > self.nearest_max_km:
            return None
        return Extraction("nearest_pixel", 1, float(sub[i]), round(float(d[i]), 3))


def extract(data: np.ndarray, grid: Grid, geom: BaseGeometry, nearest_max_km: float) -> Extraction | None:
    return Extractor(geom, grid, nearest_max_km).extract(data)
