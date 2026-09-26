"""An in-memory JAXA Earth API store: STAC items and small COGs at the real URLs, for hermetic tests."""

import json
from datetime import date

import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from pipeline.core.clients.jaxa_earth import COLLECTIONS, period_path, tiles

# Small patches around Karakuwa, aligned to each product's pixel grid.
SGLI_BOUNDS = (141.5, 38.7, 141.9, 39.1)
COARSE_BOUNDS = (140.0, 38.0, 143.0, 40.0)
SGLI_RES = 1 / 360
COARSE_RES = 0.2

# (slope, offset, dtype, nodata) as published in the real items.
SGLI_SST = (0.0012000000569969416, -10.0, "uint16", 65535)
SGLI_CHLA = (0.0015999999595806003, 0.0, "uint16", 65535)
COARSE_SST = (0.01, 0.0, "int16", -32768)


def cog(values: np.ndarray, bounds, res: float, scaling) -> bytes:
    slope, offset, dtype, nodata = scaling
    dn = np.where(np.isnan(values), nodata, np.round((values - offset) / slope)).astype(dtype)
    h, w = dn.shape
    with MemoryFile() as mem:
        with mem.open(
            driver="GTiff", height=h, width=w, count=1, dtype=dtype, crs="EPSG:4326",
            transform=from_origin(bounds[0], bounds[3], res, res), nodata=nodata,
        ) as dst:
            dst.write(dn, 1)
        return mem.read()


class FakeJaxa:
    def __init__(self):
        self.files: dict[str, bytes] = {}
        self.requests: list[str] = []

    def download(self, url: str, timeout: float, retries: int) -> bytes | None:
        self.requests.append(url)
        return self.files.get(url)

    def add(self, coll_key: str, when: date, values: np.ndarray, bounds, res: float, scaling) -> None:
        coll = COLLECTIONS[coll_key]
        (tile,) = tiles(coll, bounds)
        base = f"{coll.url}/{period_path(coll.cadence, when)}/{coll.level}/{tile.lon}"
        href = f"{tile.lon}-{tile.lat}-{coll.asset}.tiff"
        slope, offset, dtype, nodata = scaling
        item = {
            "type": "Feature",
            "collection": coll.id,
            "properties": {"start_datetime": f"{when}T11:48:00Z", "end_datetime": f"{when}T11:51:00Z"},
            "assets": {
                coll.asset: {
                    "href": f"./{href}",
                    "je:rasters": {
                        "value": {"unit": "degC"},
                        "dn2value": {"slope": slope, "offset": offset},
                        "dn": {"data_type": dtype, "nodata": nodata, "error": [nodata]},
                    },
                }
            },
        }
        self.files[f"{base}/{tile.lat}.json"] = json.dumps(item).encode()
        self.files[f"{base}/{href}"] = cog(values, bounds, res, scaling)

    @staticmethod
    def field(bounds, res: float, value: float) -> np.ndarray:
        w = round((bounds[2] - bounds[0]) / res)
        h = round((bounds[3] - bounds[1]) / res)
        return np.full((h, w), value, dtype=np.float64)

    def sgli(self, coll_key: str, when: date, value: float | np.ndarray, scaling=SGLI_SST) -> None:
        values = value if isinstance(value, np.ndarray) else self.field(SGLI_BOUNDS, SGLI_RES, value)
        self.add(coll_key, when, values, SGLI_BOUNDS, SGLI_RES, scaling)

    def coarse(self, coll_key: str, when: date, value: float) -> None:
        self.add(coll_key, when, self.field(COARSE_BOUNDS, COARSE_RES, value), COARSE_BOUNDS, COARSE_RES, COARSE_SST)


def cloud_except(lon: float, lat: float, value: float) -> np.ndarray:
    """An SGLI patch that is all cloud except the pixel containing (lon, lat)."""
    v = FakeJaxa.field(SGLI_BOUNDS, SGLI_RES, np.nan)
    col = int((lon - SGLI_BOUNDS[0]) / SGLI_RES)
    row = int((SGLI_BOUNDS[3] - lat) / SGLI_RES)
    v[row, col] = value
    return v
