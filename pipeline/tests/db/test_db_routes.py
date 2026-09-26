"""Routes backed by PostGIS: HAB bans (#80), uploaded plots, stations and POST /risk.

Needs a migrated database reachable as the `pipeline` role: `scripts/testdb.sh up` starts a throwaway one and prints
the PIPELINE_TEST_DATABASE_URL export. Skipped otherwise. Rows are never deleted (the role can't), so tests use
unique codes and idempotent upserts.
"""

import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pipeline.api import create_app
from pipeline.core import db, stations
from pipeline.hazards.hab import bans

URL = os.environ.get("PIPELINE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="PIPELINE_TEST_DATABASE_URL is not set (scripts/testdb.sh up)")

REPO_DATA = Path(__file__).resolve().parents[2] / "data"
BULLETIN_SHA = "39851aa6b573d9a4491f48fb2595609ffb07f84ac4a42000ab81fb1c4563d708"
PLOT = {
    "type": "Polygon",
    "coordinates": [[[141.680, 38.900], [141.682, 38.900], [141.682, 38.902], [141.680, 38.902], [141.680, 38.900]]],
}

client = TestClient(create_app())


@pytest.fixture(autouse=True)
def database(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", URL)


@pytest.fixture
def published_bans():
    assert bans.build()["bans"]["upserted"] == 2


# --- HAB ---------------------------------------------------------------------------


def test_hab_build_publishes_the_reviewed_table_idempotently(published_bans):
    assert bans.build()["bans"]["upserted"] == 2
    rows = client.get("/hab/bans", params={"season": "2026"}).json()
    assert [(r["seaArea"], r["restrictedFrom"], r["liftedOn"]) for r in rows] == [
        ("karakuwa-east", "2026-05-12", "2026-09-15"),
        ("kesennuma-bay", "2026-05-26", "2026-09-08"),
    ]
    assert rows[0]["level"] == "出荷自主規制" and rows[0]["confidence"] == "high" and rows[0]["pref"] == "miyagi"
    assert client.get("/hab/bans", params={"season": "2025"}).json() == []
    assert client.get("/hab/bans", params={"season": "2026", "pref": "hokkaido"}).json() == []


def test_hab_indices_banweeks_with_bulletin_provenance(published_bans):
    """#80 done-when: /hab/indices/<zone>/2026 returns BANWEEKS with provenance matching the reviewed bulletin."""
    body = client.get("/hab/indices/karakuwa-east/2026").json()
    assert body["module"] == "hab" and body["season"] == "2026"
    series = {(s["index"], s["species"], s["toxin"]): s for s in body["series"]}
    assert set(series) == {("BANWEEKS", "scallop", "PSP"), ("BAN_ACTIVE", "scallop", "PSP")}
    weeks = {p["date"]: p for p in series[("BANWEEKS", "scallop", "PSP")]["points"]}
    assert weeks["2026-06-02"]["value"] == 4
    assert weeks["2026-06-02"]["source"] == {"product": "miyagi-shellfish-toxin-bulletin", "sha256": BULLETIN_SHA}
    assert weeks["2026-09-15"]["value"] == 0
    assert min(weeks) == "2026-05-12" and max(weeks) == "2026-09-15"
    active = {p["date"]: p["value"] for p in series[("BAN_ACTIVE", "scallop", "PSP")]["points"]}
    assert active["2026-06-02"] == 1 and active["2026-09-15"] == 0
    assert client.get("/hab/indices/karakuwa-east/2025").json()["series"] == []


def test_hab_plot_risk_inherits_the_sea_area(published_bans):
    body = client.get("/hab/plots/p1213-001/risk", params={"season": "2026"}).json()
    assert body["plot"]["seaArea"] == "karakuwa-east"
    fired = [i for i in body["indices"] if i["index"] == "BANWEEKS" and i["asOf"] == "2026-06-02"]
    assert fired == [
        {
            "index": "BANWEEKS",
            "unit": "weeks",
            "value": 4.0,
            "asOf": "2026-06-02",
            "source": {"product": "miyagi-shellfish-toxin-bulletin", "sha256": BULLETIN_SHA},
            "pixels": None,
            "species": "scallop",
            "toxin": "PSP",
        }
    ]
    # A hoya plot in the same sea area: no published hoya restriction, so no ban indices.
    assert client.get("/hab/plots/p1213-009/risk", params={"season": "2026"}).json()["indices"] == []


def test_hab_risk_for_a_feature(published_bans):
    body = client.post(
        "/hab/risk",
        json={
            "feature": {"type": "Feature", "properties": {}, "geometry": PLOT},
            "start": "2026-06-01",
            "end": "2026-06-03",
            "species": "scallop",
        },
    ).json()
    assert body["plot"]["seaArea"] == "karakuwa-east"
    assert [(i["index"], i["asOf"], i["value"]) for i in body["indices"]] == [
        ("BANWEEKS", "2026-06-01", 3.0),
        ("BAN_ACTIVE", "2026-06-01", 1.0),
        ("BANWEEKS", "2026-06-02", 4.0),
        ("BAN_ACTIVE", "2026-06-02", 1.0),
        ("BANWEEKS", "2026-06-03", 4.0),
        ("BAN_ACTIVE", "2026-06-03", 1.0),
    ]


def test_combined_risk(published_bans):
    feature = {"type": "Feature", "properties": {}, "geometry": PLOT}
    body = client.post(
        "/risk",
        json={"feature": feature, "start": "2026-06-01", "end": "2026-06-02", "species": "scallop", "gear": "longline"},
    ).json()
    assert body["plot"]["seaArea"] == "karakuwa-east"
    assert body["heat"] is None  # no heat layers built in the test data dir
    assert body["storm"] is None  # not implemented yet (#81)
    assert [i["value"] for i in body["hab"]["indices"] if i["index"] == "BANWEEKS"] == [3.0, 4.0]
    no_species = client.post("/risk", json={"feature": feature, "start": "2026-06-01", "end": "2026-06-02"}).json()
    assert no_species["hab"] is None


# --- plots ---------------------------------------------------------------------------


def test_upload_plot_then_list_and_use_it(published_bans):
    code = f"t-{uuid.uuid4().hex[:8]}"
    r = client.post(
        "/plots", json={"plotCode": code, "geometry": PLOT, "species": ["scallop"], "operation": "longline"}
    )
    assert r.status_code == 201, r.text
    plot = r.json()
    assert plot["plotCode"] == f"upload:{code}" and plot["source"] == "upload"
    assert plot["seaArea"] == "karakuwa-east" and plot["geometry"]["type"] == "MultiPolygon"
    assert plot["areaM2"] == pytest.approx(173.6 * 220.6, rel=0.05)

    listed = client.get("/plots", params={"bbox": "141.679,38.899,141.683,38.903"}).json()
    assert f"upload:{code}" in {p["plotCode"] for p in listed}

    risk = client.get(f"/hab/plots/upload:{code}/risk", params={"season": "2026"}).json()
    assert any(i["asOf"] == "2026-06-02" and i["value"] == 4 for i in risk["indices"])

    again = client.post(
        "/plots", json={"plotCode": code, "geometry": PLOT, "species": ["scallop"], "operation": "longline"}
    )
    assert again.status_code == 409


def test_plots_list_every_database_origin_over_the_seed():
    listed = {p["plotCode"]: p for p in client.get("/plots").json()}
    # The demo plots come from the database with their real 区画漁業権 zones, not the seed's synthetic rectangles.
    demo = listed["p1213-001"]
    assert demo["source"] == "fishery_right" and demo["areaM2"] > 100_000
    assert client.get("/hab/plots/p1213-001/risk", params={"season": "2026"}).status_code == 200


def test_upload_rejects_an_invalid_polygon():
    bowtie = {
        "type": "Polygon",
        "coordinates": [[[141.68, 38.90], [141.69, 38.91], [141.69, 38.90], [141.68, 38.91], [141.68, 38.90]]],
    }
    r = client.post(
        "/plots", json={"plotCode": "bowtie", "geometry": bowtie, "species": ["scallop"], "operation": "raft"}
    )
    assert r.status_code == 422


# --- stations ------------------------------------------------------------------------


def test_registry_skips_stations_without_a_position():
    result = stations.build()
    assert result["skipped"] == {"miyagi-futatsune": "no published position"}


def test_load_stations_and_read_a_series():
    """The Futatsune adapter against a registry entry given a position (the real entry has none yet)."""
    entry = {**stations.registry()[0], "stationId": "test-futatsune", "lat": 38.88, "lon": 141.60}
    with db.connect() as conn:
        result = stations.load(conn, [entry], lambda e: stations.futatsune(e, REPO_DATA / "buoy"))
    lines = sum(
        1
        for f in ("futatsune-2026-08.csv", "futatsune-2026-09.csv")
        for line in (REPO_DATA / "buoy" / f).read_text().splitlines()
        if line.strip()
    )
    assert result["loaded"] == {"test-futatsune": lines}

    listed = {
        s["stationId"]: s
        for s in client.get("/stations", params={"bbox": "141.5,38.8,141.7,38.9", "type": "buoy"}).json()
    }
    assert listed["test-futatsune"]["seaArea"] == "kesennuma-bay" and listed["test-futatsune"]["cadence"] == "PT30M"
    assert "test-futatsune" not in {s["stationId"] for s in client.get("/stations", params={"type": "tide"}).json()}

    s = client.get("/stations/test-futatsune/series", params={"var": "WT"}).json()
    assert s["unit"] == "degC" and s["depthM"] == 3 and len(s["points"]) == lines
    assert len(s["sources"]) == 2
    first = datetime.fromisoformat(s["points"][0]["t"])
    assert first == datetime(2026, 7, 31, 15, 21, 32, tzinfo=UTC)  # 2026/08/01 00:21:32 JST
    assert s["points"][0]["value"] == pytest.approx(21.9055)

    window = client.get(
        "/stations/test-futatsune/series",
        params={"var": "WT", "start": "2026-09-01T00:00:00+09:00", "end": "2026-09-01T02:00:00+09:00"},
    ).json()
    assert 1 <= len(window["points"]) <= 5
    assert client.get("/stations/nope/series", params={"var": "WT"}).status_code == 404
