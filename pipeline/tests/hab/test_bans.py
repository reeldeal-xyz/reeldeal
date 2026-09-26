"""Shellfish toxin bans (#80): normalization, the reviewed table, BANWEEKS / BAN_ACTIVE and the no-database routes."""

from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pipeline.api import create_app
from pipeline.hazards.hab import bans
from pipeline.hazards.hab.indices import ban_days
from pipeline.hazards.hab.schemas import BanInterval

REPO_DATA = Path(__file__).resolve().parents[2] / "data"
BULLETIN_SHA = "39851aa6b573d9a4491f48fb2595609ffb07f84ac4a42000ab81fb1c4563d708"

client = TestClient(create_app())


def _reviewed() -> list[BanInterval]:
    return bans.read_reviewed(REPO_DATA / "ref" / "hab" / "bans.csv")


def test_reviewed_table_matches_the_transcribed_bulletin():
    """data/ref/hab/bans.csv is the normalizer's output; a changed transcription must come with a reviewed CSV diff."""
    normalized = [b for p in sorted((REPO_DATA / "toxin").glob("*-ban-*.json")) for b in bans.normalize_miyagi(p)]
    assert bans.to_csv(normalized) == (REPO_DATA / "ref" / "hab" / "bans.csv").read_text()


def test_reviewed_intervals():
    rows = {b.sea_area: b for b in _reviewed()}
    assert set(rows) == {"karakuwa-east", "kesennuma-bay"}  # the prior kesennuma episode has no published start
    k = rows["karakuwa-east"]
    assert (k.species, k.toxin, k.level, k.restricted_from, k.lifted_on) == (
        "scallop",
        "PSP",
        "出荷自主規制",
        date(2026, 5, 12),
        date(2026, 9, 15),
    )
    assert k.sha256 == BULLETIN_SHA and k.confidence == "high"


def _series(zone: str) -> dict[date, tuple[int, int]]:
    ban = next(b for b in _reviewed() if b.sea_area == zone)
    return {
        d.day: (d.banweeks, d.active) for d in ban_days([ban], date(2026, 1, 1), date(2026, 12, 31), date(2026, 12, 31))
    }


def test_banweeks_reaches_threshold_on_the_fourth_weekly_test():
    """Matches the app's BANWEEKS fixtures (web/src/fixtures/banweeks.ts) and the ReliefPool demo event."""
    k = _series("karakuwa-east")
    assert k[date(2026, 5, 12)] == (1, 1)
    assert k[date(2026, 5, 18)] == (1, 1)
    assert k[date(2026, 6, 1)] == (3, 1)
    assert k[date(2026, 6, 2)] == (4, 1)
    assert k[date(2026, 9, 14)] == (18, 1)
    assert k[date(2026, 9, 15)] == (0, 0)  # lifted
    assert date(2026, 5, 11) not in k and date(2026, 9, 16) not in k  # outside the published interval: omitted
    assert _series("kesennuma-bay")[date(2026, 6, 16)] == (4, 1)


def test_open_restriction_runs_through_the_given_day_and_windows_clip():
    open_ban = _reviewed()[0].model_copy(update={"lifted_on": None})
    days = ban_days([open_ban], date(2026, 6, 1), date(2026, 12, 31), through=date(2026, 6, 10))
    assert [d.day for d in days] == [date(2026, 6, d) for d in range(1, 11)]
    assert days[0].banweeks == 3  # counted from the restriction start, not the window start
    assert days[0].source.sha256 == BULLETIN_SHA and days[0].source.product == "miyagi-shellfish-toxin-bulletin"


@pytest.mark.parametrize(
    "url", ["/hab/indices/karakuwa-east/2026", "/hab/bans?season=2026", "/hab/plots/p1213-001/risk?season=2026"]
)
def test_database_routes_answer_503_without_a_database(url):
    assert client.get(url).status_code == 503


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("/hab/indices/nowhere/2026", 404),
        ("/hab/indices/karakuwa-east/26", 422),
        ("/hab/plots/nope/risk?season=2026", 404),
    ],
)
def test_route_validation(url, code):
    assert client.get(url).status_code == code
