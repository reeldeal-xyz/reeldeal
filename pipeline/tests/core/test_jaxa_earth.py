from datetime import date

import numpy as np
import pytest
from fakes import COARSE_BOUNDS, SGLI_BOUNDS, cloud_except

from pipeline.core.clients.jaxa_earth import (
    COLLECTIONS,
    fetch,
    period_path,
    read,
    tiles,
)

NIGHT = COLLECTIONS["sgli_sst_night_daily"]
AMSR2 = COLLECTIONS["amsr2_sst_night_daily"]


@pytest.mark.parametrize(
    ("key", "when", "path"),
    [
        ("sgli_sst_night_daily", date(2025, 8, 3), "2025-08/03"),
        ("sgli_sst_night_monthly", date(2025, 8, 17), "2025-08"),
        ("sgli_sst_night_half_monthly", date(2025, 8, 17), "2025-08/16"),
        ("sgli_sst_night_half_monthly", date(2025, 8, 15), "2025-08/01"),
        ("cobe_sst_normal", date(2025, 8, 3), "08-03"),
        ("cobe_sst_normal", date(2024, 2, 29), "02-28"),
    ],
)
def test_period_path(key, when, path):
    assert period_path(COLLECTIONS[key].cadence, when) == path


def test_tiles_match_the_store_layout():
    (t,) = tiles(NIGHT, (140.8, 37.7, 142.0, 39.1))
    assert (t.lon, t.lat) == ("E140.00-E150.00", "N30.00-N40.00")
    assert [x.lon for x in tiles(NIGHT, (139.5, 35.0, 141.0, 36.0))] == ["E130.00-E140.00", "E140.00-E150.00"]
    (coarse,) = tiles(AMSR2, (140.8, 37.7, 142.0, 39.1))
    assert (coarse.lon, coarse.lat) == ("E000.00-E180.00", "S90.00-N90.00")
    assert tiles(AMSR2, (-10.0, 0.0, 10.0, 1.0))[0].lon == "W180.00-E000.00"


def test_fetch_pins_item_and_cog_and_read_calibrates(jaxa):
    day = date(2025, 8, 1)
    jaxa.sgli("sgli_sst_night_daily", day, cloud_except(141.7, 38.9, 24.6))
    (tf,) = fetch(NIGHT, day, (140.8, 37.7, 142.0, 39.1), "heat")
    assert tf.item.url.endswith("/2025-08/01/2/E140.00-E150.00/N30.00-N40.00.json")
    assert tf.asset.url.endswith(".tiff") and tf.scaling.missing == (65535.0,)

    r = read(tf, SGLI_BOUNDS)
    assert np.isnan(r.data).sum() == r.data.size - 1
    assert np.nanmax(r.data) == pytest.approx(24.6, abs=0.0012)
    assert r.bbox == pytest.approx(SGLI_BOUNDS)


def test_fetch_missing_period_is_empty(jaxa):
    assert fetch(NIGHT, date(2025, 8, 2), (140.8, 37.7, 142.0, 39.1), "heat") == []


def test_read_windows_to_bbox(jaxa):
    day = date(2025, 8, 1)
    jaxa.coarse("amsr2_sst_night_daily", day, 22.0)
    (tf,) = fetch(AMSR2, day, COARSE_BOUNDS, "heat")
    r = read(tf, (141.0, 38.0, 142.0, 39.0))
    assert r.data.shape == (5, 5)
    assert np.all(r.data == pytest.approx(22.0))
    assert read(tf, (100.0, 0.0, 101.0, 1.0)) is None
