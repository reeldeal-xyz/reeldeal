"""XYZ map tiles rendered from the precomputed layers (README §9 "Layers on disk").

    GET /<module>/tiles/<region>/<cadence>/<period>/<layer>/<z>/<x>/<y>.png

The path mirrors the layer's place on disk, so a tile names exactly one GeoTIFF. Each 256×256 Web Mercator tile
is filled by nearest-neighbour lookup into the EPSG:4326 grid (no resampling: every coloured pixel is one grid
cell's value) and coloured on a fixed per-variable scale, so colours mean the same thing across days and
regions. Missing cells (cloud, land, no pass) are transparent. Tiles are for display only; values come from the
index routes, never from pixel colours.
"""

import math
import os
import re
import struct
import zlib
from functools import lru_cache
from pathlib import Path as FilePath
from typing import Literal

import numpy as np
from fastapi import APIRouter, HTTPException, Path, Response, status

from pipeline.core.config import out_dir
from pipeline.core.grid import Layer, read_layer
from pipeline.core.regions import REGIONS
from pipeline.core.schemas import ModuleName, TileScale

TILE = 256
MAX_ZOOM = 16
CACHE_CONTROL = "public, max-age=3600"

Cadence = Literal["daily", "daily-normal", "half-monthly", "monthly"]

# Ocean-colour style ramp (deep blue → cyan → green → yellow → red), the usual look for chl-a and SST maps.
RAMP = ("#2c1c7a", "#2a4fb8", "#2294c9", "#2fc0b0", "#7ad86b", "#d7e24a", "#f6a93b", "#d8412f")

SCALES: dict[str, TileScale] = {
    # chl-a spans orders of magnitude: 0.1 (open ocean) to 30 mg/m3 (blooming embayments).
    "CHL": TileScale(kind="log", min=0.1, max=30.0, unit="mg/m3", colors=list(RAMP)),
    # Tohoku coastal SST over a year; the heat thresholds (24–26 °C) sit in the upper third.
    "SST": TileScale(kind="linear", min=0.0, max=30.0, unit="degC", colors=list(RAMP)),
}

PERIOD = {
    "daily": re.compile(r"^\d{4}-\d{2}-\d{2}$"),
    "half-monthly": re.compile(r"^\d{4}-\d{2}-(01|16)$"),
    "monthly": re.compile(r"^\d{4}-\d{2}$"),
    "daily-normal": re.compile(r"^\d{2}-\d{2}$"),
}
LAYER_NAME = re.compile(r"^[a-z0-9_]{1,64}$")


def scale_for(variable: str) -> TileScale | None:
    return SCALES.get(variable)


def tile_url(module: str, region: str, cadence: str, period: str, layer: str) -> str:
    """Root-relative XYZ template for one layer; the client prefixes the API origin (or its own proxy)."""
    return f"/{module}/tiles/{region}/{cadence}/{period}/{layer}/{{z}}/{{x}}/{{y}}.png"


@lru_cache(maxsize=64)
def _read_cached(path: FilePath, mtime_ns: int) -> Layer | None:
    return read_layer(path)


def load_path(path: FilePath) -> Layer | None:
    """A layer file, cached until it is rebuilt."""
    try:
        mtime = os.stat(path).st_mtime_ns
    except FileNotFoundError:
        return None
    return _read_cached(path, mtime)


# --- rendering -----------------------------------------------------------------


@lru_cache(maxsize=16)
def _palette(colors: tuple[str, ...]) -> np.ndarray:
    """256×3 uint8 lookup table interpolated between the stops."""
    stops = np.array([[int(c[i : i + 2], 16) for i in (1, 3, 5)] for c in colors], dtype=np.float64)
    at = np.linspace(0, 1, len(colors))
    t = np.linspace(0, 1, 256)
    return np.stack([np.interp(t, at, stops[:, k]) for k in range(3)], axis=1).round().astype(np.uint8)


def normalise(values: np.ndarray, scale: TileScale) -> np.ndarray:
    """Values → 0..1 on the scale, clipped at both ends."""
    if scale.kind == "log":
        with np.errstate(divide="ignore", invalid="ignore"):
            v = (np.log10(np.maximum(values, 1e-9)) - math.log10(scale.min)) / (math.log10(scale.max) - math.log10(scale.min))
    else:
        v = (values - scale.min) / (scale.max - scale.min)
    return np.clip(v, 0.0, 1.0)


def tile_lonlat(z: int, x: int, y: int) -> tuple[np.ndarray, np.ndarray]:
    """Longitudes (per column) and latitudes (per row) of the pixel centres of one Web Mercator tile."""
    n = 2**z
    i = (np.arange(TILE) + 0.5) / TILE
    lons = (x + i) / n * 360.0 - 180.0
    lats = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + i) / n))))
    return lons, lats


def render(layer: Layer, scale: TileScale, z: int, x: int, y: int) -> np.ndarray | None:
    """RGBA tile, or None when it doesn't touch the layer's grid."""
    g = layer.grid
    lons, lats = tile_lonlat(z, x, y)
    cols = np.floor((lons - g.west) / g.res).astype(np.int64)
    rows = np.floor((g.north - lats) / g.res).astype(np.int64)
    h, w = layer.data.shape
    col_ok, row_ok = (cols >= 0) & (cols < w), (rows >= 0) & (rows < h)
    if not col_ok.any() or not row_ok.any():
        return None
    values = layer.data[np.clip(rows, 0, h - 1)[:, None], np.clip(cols, 0, w - 1)[None, :]]
    valid = row_ok[:, None] & col_ok[None, :] & ~np.isnan(values)
    idx = (normalise(np.where(valid, values, scale.min), scale) * 255).round().astype(np.uint8)
    rgba = np.zeros((TILE, TILE, 4), dtype=np.uint8)
    rgba[..., :3] = _palette(tuple(scale.colors))[idx]
    rgba[..., 3] = np.where(valid, 255, 0)
    return rgba


def png(rgba: np.ndarray) -> bytes:
    """Minimal RGBA PNG encoder (filter 0 on every row), so tiles need no imaging dependency."""
    h, w, _ = rgba.shape
    raw = np.concatenate([np.zeros((h, 1), dtype=np.uint8), rgba.reshape(h, w * 4)], axis=1).tobytes()

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


EMPTY_PNG = png(np.zeros((TILE, TILE, 4), dtype=np.uint8))


# --- route ---------------------------------------------------------------------


def add_tile_route(router: APIRouter, module: ModuleName) -> None:
    """Mount GET /<module>/tiles/... on a module router."""

    @router.get(
        "/tiles/{region}/{cadence}/{period}/{layer}/{z}/{x}/{y}.png",
        response_class=Response,
        responses={200: {"content": {"image/png": {}}, "description": "256×256 RGBA PNG; transparent where missing"}},
    )
    def tile(
        region: str,
        cadence: Cadence,
        period: str,
        layer: str,
        z: int = Path(ge=0, le=MAX_ZOOM),
        x: int = Path(ge=0),
        y: int = Path(ge=0),
    ) -> Response:
        """XYZ PNG tile of one precomputed layer (its `tileUrl` in `/layers/{date}`). Display only."""
        if region not in REGIONS or not PERIOD[cadence].match(period) or not LAYER_NAME.match(layer):
            raise HTTPException(422, detail="unknown region, period or layer name")
        if x >= 2**z or y >= 2**z:
            raise HTTPException(422, detail="tile outside the zoom level")
        found = load_path(out_dir(module) / "layers" / region / cadence / period / f"{layer}.tif")
        if found is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"layer {layer} for {period} has not been built")
        scale = scale_for(found.meta.get("variable", ""))
        if scale is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"layer {layer} has no display scale")
        rgba = render(found, scale, z, x, y)
        headers = {"Cache-Control": CACHE_CONTROL}
        if sha := found.meta.get("sha256"):
            headers["ETag"] = f'"{sha[:32]}-{z}-{x}-{y}"'
        return Response(EMPTY_PNG if rgba is None else png(rgba), media_type="image/png", headers=headers)
