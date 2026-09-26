"""Precomputed layers built from JAXA Earth API products (README §2 "precompute nationally, sample per plot", §9).

A layer is one product for one period (a day, a half-month, a month, or a calendar-day normal) on a region's
grid, stored at

    out/<module>/layers/<region>/<cadence>/<period>/<layer>.tif   (+ .json: provenance and LayerInfo fields)

Modules declare their layers as `LayerSpec`s; this module fetches, pins, regrids and writes them. API requests
only read these files; there are no satellite calls in the request path.
"""

import json
import os
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np
from shapely.geometry import box
from shapely.geometry.base import BaseGeometry

from pipeline.core.clients.jaxa_earth import (
    COLLECTIONS,
    Collection,
    fetch,
    period_start,
    read,
)
from pipeline.core.config import out_dir
from pipeline.core.grid import Grid, Layer, read_layer, to_grid, write_layer
from pipeline.core.pin import combined_sha256
from pipeline.core.regions import REGIONS, Region
from pipeline.core.schemas import LayerInfo, ModuleName
from pipeline.core.tiles import scale_for, tile_url


@dataclass(frozen=True)
class LayerSpec:
    name: str
    collection: str
    """Key in `jaxa_earth.COLLECTIONS`."""
    variable: str
    unit: str
    nearest_max_km: float
    """How far `nearest_pixel` extraction may reach in this product (README §3)."""

    @property
    def coll(self) -> Collection:
        return COLLECTIONS[self.collection]

    @property
    def product(self) -> str:
        return self.coll.product


def days(start: date, end: date) -> list[date]:
    return [start + timedelta(n) for n in range((end - start).days + 1)]


def months(start: date, end: date) -> list[date]:
    """First day of every month overlapping [start, end]."""
    out, m = [], start.replace(day=1)
    while m <= end:
        out.append(m)
        m = (m + timedelta(days=32)).replace(day=1)
    return out


def period_label(cadence: str, when: date) -> str:
    when = period_start(cadence, when)  # type: ignore[arg-type]
    if cadence == "monthly":
        return f"{when:%Y-%m}"
    if cadence == "daily-normal":
        return "02-28" if (when.month, when.day) == (2, 29) else f"{when:%m-%d}"
    return when.isoformat()


def layer_path(module: ModuleName, region_id: str, spec: LayerSpec, when: date) -> Path:
    cadence = spec.coll.cadence
    return out_dir(module) / "layers" / region_id / cadence / period_label(cadence, when) / f"{spec.name}.tif"


def build_layer(
    module: ModuleName,
    spec: LayerSpec,
    when: date,
    region: Region,
    *,
    offline: bool = False,
    refresh: bool = False,
    force: bool = False,
) -> Path | None:
    """Fetch (pin) and grid one layer. Returns its path, or None if JAXA has no file for that period yet.

    An existing layer is kept unless `force`; `refresh` also re-downloads the inputs.
    """
    path = layer_path(module, region.id, spec, when)
    if path.exists() and not (force or refresh):
        return path
    coll = spec.coll
    grid = Grid.snap(region.bbox)
    files = fetch(coll, when, grid.bbox, module, offline=offline, refresh=refresh)
    if not files:
        return None
    rasters = [r for tf in files if (r := read(tf, grid.bbox)) is not None]
    data = to_grid(rasters, grid)
    valid = float(np.mean(~np.isnan(data)))
    starts = [tf.start for tf in files if tf.start]
    ends = [tf.end for tf in files if tf.end]
    meta = {
        "module": module,
        "layer": spec.name,
        "cadence": coll.cadence,
        "date": period_start(coll.cadence, when).isoformat(),
        "region": region.id,
        "product": coll.product,
        "variable": spec.variable,
        "unit": spec.unit,
        "bbox": list(grid.bbox),
        "valid_fraction": round(valid, 6),
        "sha256": combined_sha256([tf.asset.sha256 for tf in files]),
        "collection": coll.id,
        "observed": {"start": min(starts, default=None), "end": max(ends, default=None)},
        "grid": {"res": grid.res, "shape": list(grid.shape)},
        "inputs": [
            {
                "url": tf.asset.url,
                "sha256": tf.asset.sha256,
                "fetchedAt": tf.asset.fetched_at,
                "item": {"url": tf.item.url, "sha256": tf.item.sha256},
                "scaling": {"slope": tf.scaling.slope, "offset": tf.scaling.offset, "missing": list(tf.scaling.missing)},
            }
            for tf in files
        ],
    }
    write_layer(path, data, grid, meta)
    return path


@lru_cache(maxsize=512)
def _read_cached(path: Path, mtime_ns: int) -> Layer | None:
    return read_layer(path)


def load(module: ModuleName, region_id: str, spec: LayerSpec, when: date) -> Layer | None:
    path = layer_path(module, region_id, spec, when)
    try:
        mtime = os.stat(path).st_mtime_ns
    except FileNotFoundError:
        return None
    return _read_cached(path, mtime)


def region_for(module: ModuleName, geom: BaseGeometry) -> Region | None:
    """The smallest built region whose bbox contains the geometry."""
    root = out_dir(module) / "layers"
    candidates = [
        r for r in REGIONS.values() if box(*r.bbox).contains(geom) and (root / r.id).is_dir()
    ]
    return min(candidates, key=lambda r: box(*r.bbox).area, default=None)


def _info(meta_path: Path) -> LayerInfo | None:
    try:
        meta = json.loads(meta_path.read_text())
    except (OSError, ValueError):
        return None
    info = LayerInfo.model_validate({k: v for k, v in meta.items() if k in LayerInfo.model_fields})
    scale = scale_for(info.variable)
    if scale is None:
        return info
    url = tile_url(info.module, info.region, info.cadence, period_label(info.cadence, info.date), info.layer)
    return info.model_copy(update={"tile_url": url, "tile_scale": scale})


def layers_on(module: ModuleName, day: date) -> list[LayerInfo]:
    """Every built layer covering a date: that day's layers, its calendar-day normals and the composites containing it."""
    root = out_dir(module) / "layers"
    if not root.is_dir():
        return []
    out = []
    for region_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        for cadence in ("daily", "daily-normal", "half-monthly", "monthly"):
            period_dir = region_dir / cadence / period_label(cadence, day)
            out += [i for m in sorted(period_dir.glob("*.json")) if (i := _info(m))]
    return out
