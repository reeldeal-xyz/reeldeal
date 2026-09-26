"""The common analysis grid and layer files (README §3, §9).

The grid is EPSG:4326 at SGLI's native 1/360° (~300 m), snapped so SGLI pixels map 1:1 with no resampling.
Coarser products (AMSR2, COBE-SST at 0.2°) are put on it by nearest neighbour, so each grid cell carries the
coarse pixel's value unchanged.

Layers are single-band float32 GeoTIFFs (NaN = missing) with a JSON sidecar naming the pinned inputs. The
coastal mask (≤ 30 km offshore, Q8) is not applied yet; builds run per region, and the Miyagi region is small.
"""

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import Affine, from_origin
from rasterio.warp import reproject

from pipeline.core.clients.jaxa_earth import BBox, Raster

SGLI_RES = 1 / 360
CRS = "EPSG:4326"


@dataclass(frozen=True)
class Grid:
    west: float
    south: float
    east: float
    north: float
    res: float = SGLI_RES

    @classmethod
    def snap(cls, bbox: BBox, res: float = SGLI_RES) -> "Grid":
        """The smallest grid aligned to multiples of `res` that covers bbox."""
        west, south, east, north = bbox
        return cls(
            math.floor(round(west / res, 6)) * res,
            math.floor(round(south / res, 6)) * res,
            math.ceil(round(east / res, 6)) * res,
            math.ceil(round(north / res, 6)) * res,
            res,
        )

    @property
    def bbox(self) -> BBox:
        return (self.west, self.south, self.east, self.north)

    @property
    def shape(self) -> tuple[int, int]:
        return round((self.north - self.south) / self.res), round((self.east - self.west) / self.res)

    @property
    def transform(self) -> Affine:
        return from_origin(self.west, self.north, self.res, self.res)

    def empty(self) -> np.ndarray:
        return np.full(self.shape, np.nan, dtype=np.float32)

    def lonlat(self) -> tuple[np.ndarray, np.ndarray]:
        """Cell-centre longitudes (per column) and latitudes (per row)."""
        h, w = self.shape
        lons = self.west + (np.arange(w) + 0.5) * self.res
        lats = self.north - (np.arange(h) + 0.5) * self.res
        return lons, lats


def to_grid(rasters: list[Raster], grid: Grid, resampling: Resampling = Resampling.nearest) -> np.ndarray:
    """Mosaic calibrated rasters onto the grid. Tiles don't overlap; where they touch, the first valid value wins."""
    out = grid.empty()
    for r in rasters:
        dst = grid.empty()
        reproject(
            source=r.data,
            destination=dst,
            src_transform=r.transform,
            src_crs=CRS,
            src_nodata=np.nan,
            dst_transform=grid.transform,
            dst_crs=CRS,
            dst_nodata=np.nan,
            resampling=resampling,
        )
        fill = np.isnan(out) & ~np.isnan(dst)
        out[fill] = dst[fill]
    return out


def write_layer(path: Path, data: np.ndarray, grid: Grid, meta: dict) -> None:
    """Write a layer GeoTIFF and its `<name>.json` sidecar atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.part")
    h, w = grid.shape
    profile = {
        "driver": "GTiff",
        "dtype": "float32",
        "count": 1,
        "height": h,
        "width": w,
        "crs": CRS,
        "transform": grid.transform,
        "nodata": np.nan,
        "compress": "deflate",
        "predictor": 3,
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }
    with rasterio.open(tmp, "w", **profile) as dst:
        dst.write(data.astype(np.float32), 1)
    tmp.replace(path)
    path.with_suffix(".json").write_text(json.dumps(meta, indent=2, default=str) + "\n")


@dataclass
class Layer:
    data: np.ndarray
    grid: Grid
    meta: dict


def read_layer(path: Path) -> Layer | None:
    if not path.exists():
        return None
    with rasterio.open(path) as src:
        data = src.read(1)
        t = src.transform
        res = t.a
        grid = Grid(t.c, t.f - src.height * res, t.c + src.width * res, t.f, res)
    meta_path = path.with_suffix(".json")
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    return Layer(data, grid, meta)
