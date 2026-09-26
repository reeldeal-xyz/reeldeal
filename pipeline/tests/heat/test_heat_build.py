"""Heat end to end on a fake JAXA store: CLI build → layers → indices → API, covering each gap-fill branch."""

import hashlib
from datetime import date

import pytest
from fakes import cloud_except
from fastapi.testclient import TestClient

from pipeline.api import create_app
from pipeline.cli import main
from pipeline.core.plots import store

client = TestClient(create_app())

D = [date(2025, 8, d) for d in range(1, 7)]
P1 = store.get("p1213-001")
LON, LAT = P1.centroid
KM_LON = 1 / (111.32 * 0.7784)  # degrees of longitude per km at 38.9N

SGLI = "GCOM-C_SGLI_L3-SST.nighttime.v3"
SGLI_DAY = "GCOM-C_SGLI_L3-SST.daytime.v3"
AMSR2 = "GCOM-W_AMSR2_L3-SST.nighttime.v4"


@pytest.fixture
def built(jaxa):
    """Six days in August 2025 for plot p1213-001:

    1 SGLI night 20 °C · 2 night cloudy, SGLI day 21 · 3 SGLI cloudy, AMSR2 22 · 4 nothing published ·
    5 one SGLI night pixel 2.6 km away (23) · 6 one SGLI night pixel 10 km away (out of reach → null).
    COBE normal 19 °C every day; SGLI monthly composite 20.5 °C.
    """
    jaxa.sgli("sgli_sst_night_daily", D[0], 20.0)
    jaxa.sgli("sgli_sst_day_daily", D[0], 30.0)
    jaxa.coarse("amsr2_sst_night_daily", D[0], 40.0)
    jaxa.sgli("sgli_sst_night_daily", D[1], float("nan"))
    jaxa.sgli("sgli_sst_day_daily", D[1], 21.0)
    jaxa.sgli("sgli_sst_night_daily", D[2], float("nan"))
    jaxa.sgli("sgli_sst_day_daily", D[2], float("nan"))
    jaxa.coarse("amsr2_sst_night_daily", D[2], 22.0)
    jaxa.sgli("sgli_sst_night_daily", D[4], cloud_except(LON + 2.6 * KM_LON, LAT, 23.0))
    jaxa.sgli("sgli_sst_night_daily", D[5], cloud_except(LON + 10 * KM_LON, LAT, 23.0))
    for d in D:
        jaxa.coarse("cobe_sst_normal", d, 19.0)
    jaxa.sgli("sgli_sst_night_monthly", D[0], 20.5)
    assert main(["heat", "build", "--start", "2025-08-01", "--end", "2025-08-06"]) == 0
    return jaxa


def _by_index(indices: list[dict], name: str) -> list[dict]:
    return [v for v in indices if v["index"] == name]


def test_plot_season_follows_gap_fill_order(built):
    r = client.get("/heat/plots/p1213-001/risk?season=2025")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["module"] == "heat" and body["module_version"] == "heat-0.1.0"
    assert body["window"] == {"start": "2025-06-01", "end": "2025-10-31"}
    assert body["plot"]["plotCode"] == "p1213-001" and body["plot"]["seaArea"] == "karakuwa-east"

    sst = _by_index(body["indices"], "SST")
    assert [v["asOf"] for v in sst] == ["2025-08-01", "2025-08-02", "2025-08-03", "2025-08-05", "2025-08-06"]  # 4th not built
    assert [v["value"] for v in sst[:4]] == pytest.approx([20.0, 21.0, 22.0, 23.0], abs=0.002)
    assert [v["source"]["product"] for v in sst[:4]] == [SGLI, SGLI_DAY, AMSR2, SGLI]
    assert sst[3]["pixels"]["strategy"] == "nearest_pixel" and 2.3 < sst[3]["pixels"]["distanceKm"] < 3.0
    assert sst[4]["value"] is None and sst[4]["source"] is None and sst[4]["pixels"] is None

    anom = _by_index(body["indices"], "SST_ANOM")
    assert [v["value"] for v in anom] == pytest.approx([1.0, 2.0, 3.0, 4.0, None], abs=0.002)
    assert anom[0]["source"]["product"] == f"{SGLI}-minus-JMA_COBE-SST.v2.daily-normal"

    (month,) = _by_index(body["indices"], "SST_MONTH")
    assert month["asOf"] == "2025-08-31" and month["value"] == pytest.approx(20.5, abs=0.002)
    assert month["source"]["product"] == f"{SGLI}.monthly"


def test_source_sha256_is_the_pinned_cog(built):
    body = client.get("/heat/plots/p1213-001/risk?season=2025").json()
    first = _by_index(body["indices"], "SST")[0]
    cog_url = next(u for u in built.files if "nighttime.v3_global_daily/2025-08/01" in u and u.endswith(".tiff"))
    assert first["source"]["sha256"] == hashlib.sha256(built.files[cog_url]).hexdigest()


def test_zone_indices(built):
    body = client.get("/heat/indices/karakuwa-east/2025").json()
    assert body["zone"] == "karakuwa-east" and body["season"] == "2025"
    series = {s["index"]: s for s in body["series"]}
    assert set(series) == {"SST", "SST_ANOM", "SST_MONTH"}
    first = series["SST"]["points"][0]
    assert first["date"] == "2025-08-01" and first["pixels"]["strategy"] == "inside" and first["pixels"]["count"] > 100
    assert first["source"]["product"] == SGLI


def test_post_risk_samples_layers_with_heat_t(built):
    body = {"feature": {"type": "Feature", "properties": {}, "geometry": P1.geojson}, "start": "2025-08-01", "end": "2025-08-06", "t": 21.5}
    r = client.post("/heat/risk", json=body)
    assert r.status_code == 200, r.text
    (heat,) = _by_index(r.json()["indices"], "HEAT21.5")
    assert heat["value"] == 2 and heat["unit"] == "days" and heat["asOf"] == "2025-08-06"
    assert set(heat["source"]["product"].split("+")) == {SGLI, SGLI_DAY, AMSR2}
    assert "pixels" not in r.json()


def test_layers_route_lists_daily_normal_and_monthly(built):
    body = client.get("/heat/layers/2025-08-01").json()
    by = {(l["layer"], l["cadence"]) for l in body}
    assert by == {
        ("sst_sgli_night", "daily"),
        ("sst_sgli_day", "daily"),
        ("sst_amsr2_night", "daily"),
        ("sst_normal", "daily-normal"),
        ("sst_sgli_night_monthly", "monthly"),
    }
    night = next(l for l in body if l["layer"] == "sst_sgli_night")
    assert night["region"] == "miyagi" and night["unit"] == "degC" and 0 < night["validFraction"] <= 1
    assert client.get("/heat/layers/2020-01-01").json() == []


def test_offline_rebuild_needs_no_network(built):
    n = len(built.requests)
    assert main(["heat", "build", "--start", "2025-08-01", "--end", "2025-08-06", "--offline", "--force"]) == 0
    assert len(built.requests) == n


def test_errors(built):
    assert client.get("/heat/plots/nope/risk?season=2025").status_code == 404
    assert client.get("/heat/plots/p1213-001/risk?season=2024").status_code == 404  # not built
    assert client.get("/heat/plots/p1213-001/risk?season=25").status_code == 422
    assert client.get("/heat/indices/nowhere/2025").status_code == 404
    far = {"type": "Polygon", "coordinates": [[[130.0, 30.0], [130.001, 30.0], [130.001, 30.001], [130.0, 30.0]]]}
    r = client.post("/heat/risk", json={"feature": {"type": "Feature", "properties": {}, "geometry": far}, "start": "2025-08-01", "end": "2025-08-02"})
    assert r.status_code == 404 and "no heat layers" in r.json()["detail"]
    backwards = {"feature": {"type": "Feature", "properties": {}, "geometry": P1.geojson}, "start": "2025-08-02", "end": "2025-08-01"}
    assert client.post("/heat/risk", json=backwards).status_code == 422
