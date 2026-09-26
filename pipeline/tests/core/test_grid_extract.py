import math

import numpy as np
import pytest
from rasterio.transform import from_origin
from shapely.geometry import box

from pipeline.core.clients.jaxa_earth import Raster
from pipeline.core.extract import KM_PER_DEG_LAT, Extractor, buffer_m
from pipeline.core.grid import SGLI_RES, Grid, read_layer, to_grid, write_layer

GRID = Grid.snap((141.6, 38.8, 141.8, 39.0))
C_LON, C_LAT = (51012 + 0.5) / 360, (14004 + 0.5) / 360  # an SGLI pixel centre near 141.70E 38.90N
PLOT = box(C_LON - 0.0005, C_LAT - 0.0005, C_LON + 0.0005, C_LAT + 0.0005)  # ~90 m x 110 m


def test_snap_aligns_to_sgli_pixels():
    g = Grid.snap((140.8, 37.7, 142.0, 39.1))
    assert g.shape == (504, 432)
    assert g.west * 360 == pytest.approx(round(g.west * 360))
    odd = Grid.snap((140.801, 37.7001, 141.0, 37.9))
    assert odd.west <= 140.801 and odd.south <= 37.7001


def test_to_grid_upsamples_coarse_pixels_unchanged():
    coarse = Raster(np.array([[1.0, 2.0], [3.0, np.nan]], dtype=np.float32), from_origin(141.6, 39.0, 0.1, 0.1))
    out = to_grid([coarse], GRID)
    h, w = GRID.shape
    assert out[0, 0] == 1.0 and out[0, w - 1] == 2.0 and out[h - 1, 0] == 3.0
    assert np.isnan(out[h - 1, w - 1])


def test_layer_roundtrip(tmp_path):
    data = GRID.empty()
    data[10, 20] = 25.5
    write_layer(tmp_path / "x.tif", data, GRID, {"sha256": "abc"})
    layer = read_layer(tmp_path / "x.tif")
    assert layer.meta == {"sha256": "abc"}
    assert layer.grid.shape == GRID.shape and layer.grid.west == pytest.approx(GRID.west)
    assert layer.data[10, 20] == 25.5 and np.isnan(layer.data).sum() == data.size - 1


def _pixel(lon: float, lat: float) -> tuple[int, int]:
    return int((GRID.north - lat) / SGLI_RES), int((lon - GRID.west) / SGLI_RES)


def _field(points: dict[tuple[float, float], float]) -> np.ndarray:
    data = GRID.empty()
    for (lon, lat), v in points.items():
        data[_pixel(lon, lat)] = v
    return data


def test_extraction_order():
    ex = Extractor(PLOT, GRID, nearest_max_km=3.0)
    km_lon = 1 / (KM_PER_DEG_LAT * math.cos(math.radians(C_LAT)))

    full = GRID.empty()
    full[:] = 20.0
    assert ex.extract(full).strategy == "inside"

    near = _field({(C_LON + 0.35 * km_lon, C_LAT): 21.0})
    e = ex.extract(near)
    assert (e.strategy, e.count, e.value) == ("buffer_500m", 1, 21.0)

    mid = _field({(C_LON + 1.5 * km_lon, C_LAT): 22.0, (C_LON - 1.5 * km_lon, C_LAT): 24.0})
    e = ex.extract(mid)
    assert (e.strategy, e.count, e.value) == ("buffer_2km", 2, 23.0)  # median

    far = _field({(C_LON + 2.6 * km_lon, C_LAT): 23.0})
    e = ex.extract(far)
    assert e.strategy == "nearest_pixel" and e.value == 23.0 and 2.3 < e.distance_km < 3.0

    assert ex.extract(_field({(C_LON + 5 * km_lon, C_LAT): 23.0})) is None
    assert ex.extract(GRID.empty()) is None


def test_buffer_m_is_metric():
    b = buffer_m(PLOT, 500)
    w, s, e, n = b.bounds
    assert (n - s) * KM_PER_DEG_LAT == pytest.approx(1.11, abs=0.02)
