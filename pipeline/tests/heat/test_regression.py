"""Kesennuma heat regression (#77, README §13): daily SST at 38.85N 141.66E for the 2022–2025 heat seasons.

The snapshot is committed. With real Miyagi layers built locally (`pipeline heat build --season YYYY` for each
season), the test recomputes the series and compares; in CI, where no JAXA data is pinned, it checks the snapshot
itself. After an intended change to the SST conventions (Q10), regenerate with:

    REGENERATE_SNAPSHOT=1 uv run pytest tests/heat/test_regression.py
"""

import csv
import os
import re
from datetime import date
from pathlib import Path

import pytest
from shapely.geometry import box

from pipeline.core.layers import layer_path
from pipeline.core.regions import region
from pipeline.hazards.heat.indices import compute
from pipeline.hazards.heat.layers import season_window
from pipeline.hazards.heat.sources.jaxa_sst import SGLI_NIGHT

SNAPSHOT = Path(__file__).parent / "snapshots" / "kesennuma-sst-2022-2025.csv"
SEASONS = ("2022", "2023", "2024", "2025")
REF_LON, REF_LAT = 141.66, 38.85
REF = box(REF_LON - 0.0001, REF_LAT - 0.0001, REF_LON + 0.0001, REF_LAT + 0.0001)  # ~20 m around the point
FIELDS = ["date", "sst", "product", "strategy", "count", "distance_km", "sha256"]
PRODUCTS = {"GCOM-C_SGLI_L3-SST.nighttime.v3", "GCOM-C_SGLI_L3-SST.daytime.v3", "GCOM-W_AMSR2_L3-SST.nighttime.v4"}
REPO = Path(__file__).resolve().parents[2]


def _rows() -> list[dict]:
    rows = []
    for season in SEASONS:
        start, end = season_window(season)
        for v in compute(REF, region("miyagi"), start, end):
            if v.index != "SST":
                continue
            rows.append(
                {
                    "date": v.as_of.isoformat(),
                    "sst": "" if v.value is None else f"{v.value:.3f}",
                    "product": v.source.product if v.source else "",
                    "strategy": v.pixels.strategy if v.pixels else "",
                    "count": v.pixels.count if v.pixels else "",
                    "distance_km": "" if not v.pixels or v.pixels.distance_km is None else f"{v.pixels.distance_km:.3f}",
                    "sha256": v.source.sha256 if v.source else "",
                }
            )
    return rows


def _read() -> list[dict]:
    with SNAPSHOT.open() as f:
        return list(csv.DictReader(f))


@pytest.fixture
def real_dirs(monkeypatch):
    monkeypatch.setenv("PIPELINE_DATA_DIR", str(REPO / "data"))
    monkeypatch.setenv("PIPELINE_OUT_DIR", str(REPO / "out"))


def _built() -> bool:
    return all(layer_path("heat", "miyagi", SGLI_NIGHT, date(int(s), 8, 1)).exists() for s in SEASONS)


def test_snapshot_matches_recomputed_series(real_dirs):
    if not _built():
        pytest.skip("Miyagi heat layers for 2022-2025 are not built here (run `pipeline heat build --season YYYY`)")
    rows = _rows()
    if os.environ.get("REGENERATE_SNAPSHOT"):
        SNAPSHOT.parent.mkdir(exist_ok=True)
        with SNAPSHOT.open("w", newline="") as f:
            w = csv.DictWriter(f, FIELDS, lineterminator="\n")
            w.writeheader()
            w.writerows(rows)
    assert [{k: str(v) for k, v in r.items()} for r in rows] == _read()


def test_snapshot_is_well_formed():
    rows = _read()
    assert rows, "empty snapshot"
    days = [date.fromisoformat(r["date"]) for r in rows]
    assert days == sorted(set(days))
    assert {str(d.year) for d in days} == set(SEASONS)
    for r in rows:
        if r["sst"]:
            assert -2.0 < float(r["sst"]) < 35.0, r
            assert r["product"] in PRODUCTS and re.fullmatch(r"[0-9a-f]{64}", r["sha256"]), r
        else:
            assert r["product"] == r["sha256"] == "", r
