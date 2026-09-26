"""JAXA Earth API client: STAC catalogue of cloud-optimised GeoTIFFs (README §4).

This reads the Earth API's public STAC/COG store directly (the same files the `jaxa-earth` package reads),
because §2 requires pinning the exact bytes an index is computed from. No registration or API key.

Store layout, verified 2026-09-26 against https://data.earth.jaxa.jp/stac/cog/v1/catalog.json:

    {base}/{collection}/{period}/{level}/{lon tile}/{lat tile}.json      STAC item (scaling, nodata, times)
    {base}/{collection}/{period}/{level}/{lon tile}/{asset file}.tiff    the COG it points to

- period: daily and half-monthly `YYYY-MM/DD` (half-monthly DD is 01 or 16), monthly `YYYY-MM`,
  daily normals `MM-DD`.
- level: COG resolution level. SGLI's full resolution is level 2 (360 px/deg, ~300 m; README Q9) in
  10°×10° tiles such as `E140.00-E150.00/N30.00-N40.00`. AMSR2 and COBE-SST are level 0 (5 px/deg) in
  180° halves: `E000.00-E180.00/S90.00-N90.00`.
- DN to value: `value = dn * slope + offset` from the item's `je:rasters.dn2value`; `dn.nodata` and
  `dn.error` are missing values (cloud, land, no pass).
- Latency: daily SGLI files appear about 3 days after the observation; monthly composites after the month ends.

JAXA says the Earth API "may change or publication may cease without notice", so everything is pinned.
"""

import json
from dataclasses import dataclass
from datetime import date
from typing import Literal

import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import Affine
from rasterio.windows import from_bounds

from pipeline.core.pin import Pinned, open_pinned, pin

BASE_URL = "https://s3.ap-northeast-1.wasabisys.com"
STAC_ROOT = "https://data.earth.jaxa.jp/stac/cog/v1/catalog.json"

Cadence = Literal["daily", "half-monthly", "monthly", "daily-normal"]
BBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class Collection:
    id: str
    bucket: str
    asset: str
    cadence: Cadence
    level: int
    product: str
    """Short product name used in provenance (`source.product`)."""

    @property
    def url(self) -> str:
        return f"{BASE_URL}/{self.bucket}/cog/v1/{self.id}"

    @property
    def tile_deg(self) -> tuple[float, float]:
        """(lon, lat) size of one tile at this collection's level."""
        return (10.0, 10.0) if self.level == 2 else (180.0, 180.0)


def _sgli(kind: str, pass_: str, cadence: Cadence, asset: str) -> Collection:
    suffix = {"daily": "daily", "half-monthly": "half-monthly", "monthly": "monthly"}[cadence]
    return Collection(
        id=f"JAXA.G-Portal_GCOM-C.SGLI_standard.L3-{kind}.{pass_}.v3_global_{suffix}",
        bucket="je-pds",
        asset=asset,
        cadence=cadence,
        level=2,
        product=f"GCOM-C_SGLI_L3-{kind}.{pass_}.v3" + ("" if cadence == "daily" else f".{cadence}"),
    )


# Collections the pipeline ingests (README §4). Keys are the names modules use.
COLLECTIONS: dict[str, Collection] = {
    "sgli_sst_night_daily": _sgli("SST", "nighttime", "daily", "SST"),
    "sgli_sst_day_daily": _sgli("SST", "daytime", "daily", "SST"),
    "sgli_sst_night_monthly": _sgli("SST", "nighttime", "monthly", "SST"),
    "sgli_sst_day_monthly": _sgli("SST", "daytime", "monthly", "SST"),
    "sgli_sst_night_half_monthly": _sgli("SST", "nighttime", "half-monthly", "SST"),
    "sgli_chla_daily": _sgli("CHLA", "daytime", "daily", "CHLA"),
    "sgli_chla_monthly": _sgli("CHLA", "daytime", "monthly", "CHLA"),
    "sgli_chla_half_monthly": _sgli("CHLA", "daytime", "half-monthly", "CHLA"),
    "amsr2_sst_night_daily": Collection(
        id="JAXA.G-Portal_GCOM-W.AMSR2_standard.L3-SST.nighttime.v4_global_daily",
        bucket="je-pds2",
        asset="SST",
        cadence="daily",
        level=0,
        product="GCOM-W_AMSR2_L3-SST.nighttime.v4",
    ),
    "amsr2_sst_day_daily": Collection(
        id="JAXA.G-Portal_GCOM-W.AMSR2_standard.L3-SST.daytime.v4_global_daily",
        bucket="je-pds2",
        asset="SST",
        cadence="daily",
        level=0,
        product="GCOM-W_AMSR2_L3-SST.daytime.v4",
    ),
    "cobe_sst_normal": Collection(
        id="JMA_COBE-SST-interpolation_SST.v2_global_daily-normal",
        bucket="je-pds2",
        asset="SST",
        cadence="daily-normal",
        level=0,
        product="JMA_COBE-SST.v2.daily-normal",
    ),
}


def period_start(cadence: Cadence, when: date) -> date:
    """The first day of the period containing `when` (the day itself for daily products)."""
    if cadence == "monthly":
        return when.replace(day=1)
    if cadence == "half-monthly":
        return when.replace(day=1 if when.day < 16 else 16)
    return when


def period_path(cadence: Cadence, when: date) -> str:
    when = period_start(cadence, when)
    if cadence == "monthly":
        return f"{when:%Y-%m}"
    if cadence == "daily-normal":
        # 365 normals; 29 February uses 28 February's.
        return "02-28" if (when.month, when.day) == (2, 29) else f"{when:%m-%d}"
    return f"{when:%Y-%m}/{when:%d}"


def _lon_label(x: float) -> str:
    return f"{'W' if x < 0 else 'E'}{abs(x):06.2f}"


def _lat_label(y: float) -> str:
    return f"{'S' if y < 0 else 'N'}{abs(y):05.2f}"


@dataclass(frozen=True)
class Tile:
    lon: str
    lat: str
    bbox: BBox


def tiles(coll: Collection, bbox: BBox) -> list[Tile]:
    """The store's tiles intersecting a bbox."""
    dx, dy = coll.tile_deg
    west, south, east, north = bbox
    out = []
    x = np.floor((west + 180) / dx) * dx - 180
    while x < east:
        y = np.floor((south + 90) / dy) * dy - 90
        while y < north:
            x0, y0 = float(x), float(y)
            out.append(Tile(f"{_lon_label(x0)}-{_lon_label(x0 + dx)}", f"{_lat_label(y0)}-{_lat_label(y0 + dy)}", (x0, y0, x0 + dx, y0 + dy)))
            y += dy
        x += dx
    return out


@dataclass(frozen=True)
class Scaling:
    slope: float
    offset: float
    missing: tuple[float, ...]
    unit: str

    @classmethod
    def from_item(cls, item: dict, asset: str) -> "Scaling":
        rasters = item["assets"][asset]["je:rasters"]
        dn2 = rasters.get("dn2value") or {}
        if set(dn2) - {"slope", "offset"}:
            raise ValueError(f"unsupported dn2value {dn2} in {item.get('collection')}")
        dn = rasters.get("dn") or {}
        missing = {float(v) for v in [dn.get("nodata"), *(dn.get("error") or [])] if v is not None}
        return cls(
            slope=float(dn2.get("slope", 1.0)),
            offset=float(dn2.get("offset", 0.0)),
            missing=tuple(sorted(missing)),
            unit=rasters.get("value", {}).get("unit", ""),
        )


@dataclass(frozen=True)
class TileFile:
    """One pinned tile of one period: the STAC item and the COG it points to."""

    collection: Collection
    period: date
    tile: Tile
    item: Pinned
    asset: Pinned
    scaling: Scaling
    start: str | None
    end: str | None


def _relpath(coll: Collection, when: date, level: int, lon: str, name: str) -> str:
    return f"jaxa/{coll.id}/{period_path(coll.cadence, when)}/{level}/{lon}/{name}"


def fetch_tile(
    coll: Collection, when: date, tile: Tile, module: str, *, refresh: bool = False, offline: bool = False
) -> TileFile | None:
    """Pin one tile's item and COG. Returns None when JAXA has no file for that period and tile (no pass, not yet published)."""
    base = f"{coll.url}/{period_path(coll.cadence, when)}/{coll.level}/{tile.lon}"
    item_pin = pin(f"{base}/{tile.lat}.json", module, _relpath(coll, when, coll.level, tile.lon, f"{tile.lat}.json"), refresh=refresh, offline=offline)
    if item_pin is None:
        return None
    item = json.loads(open_pinned(item_pin))
    href = item["assets"][coll.asset]["href"].removeprefix("./")
    asset_pin = pin(f"{base}/{href}", module, _relpath(coll, when, coll.level, tile.lon, href), refresh=refresh, offline=offline)
    if asset_pin is None:
        return None
    props = item.get("properties") or {}
    return TileFile(
        collection=coll,
        period=period_start(coll.cadence, when),
        tile=tile,
        item=item_pin,
        asset=asset_pin,
        scaling=Scaling.from_item(item, coll.asset),
        start=props.get("start_datetime"),
        end=props.get("end_datetime"),
    )


def fetch(
    coll: Collection, when: date, bbox: BBox, module: str, *, refresh: bool = False, offline: bool = False
) -> list[TileFile]:
    """Pin every tile of a period that intersects bbox."""
    return [tf for t in tiles(coll, bbox) if (tf := fetch_tile(coll, when, t, module, refresh=refresh, offline=offline))]


@dataclass
class Raster:
    """Calibrated values (float32, NaN = missing) on a north-up EPSG:4326 grid."""

    data: np.ndarray
    transform: Affine

    @property
    def bbox(self) -> BBox:
        h, w = self.data.shape
        t = self.transform
        return (t.c, t.f + h * t.e, t.c + w * t.a, t.f)


def read(tf: TileFile, bbox: BBox | None = None) -> Raster | None:
    """Calibrated values of one pinned tile, optionally windowed to bbox. None if bbox misses the tile."""
    with MemoryFile(open_pinned(tf.asset)) as mem, mem.open() as src:
        if bbox is None:
            window = None
            transform = src.transform
        else:
            west, south, east, north = bbox
            tw, ts, te, tn = src.bounds
            clip = (max(west, tw), max(south, ts), min(east, te), min(north, tn))
            if clip[0] >= clip[2] or clip[1] >= clip[3]:
                return None
            window = from_bounds(*clip, transform=src.transform).round_offsets().round_lengths()
            transform = src.window_transform(window)
        dn = src.read(1, window=window)
    values = dn.astype(np.float32) * np.float32(tf.scaling.slope) + np.float32(tf.scaling.offset)
    values[np.isin(dn, np.array(tf.scaling.missing, dtype=dn.dtype))] = np.nan
    return Raster(values, transform)
