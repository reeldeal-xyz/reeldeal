"""Species reference data (data/ref/species.json) and the /species routes (README §5a)."""

import json
from pathlib import Path
from typing import get_args

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from pipeline.api import create_app
from pipeline.core.schemas import Species
from pipeline.core.species import SpeciesFile, species_file

client = TestClient(create_app())

SPECIES_JSON = Path(__file__).resolve().parents[2] / "data" / "ref" / "species.json"


def _doc() -> dict:
    return json.loads(SPECIES_JSON.read_text())


def test_file_lists_every_species():
    assert sorted(s.id for s in species_file().species) == sorted(get_args(Species))


def test_rules_are_the_apps_current_rules():
    """The relief path depends on these values (packages/shared RULES, contracts' TEMP_C = 25): change them deliberately."""
    rules = {(r.species, r.tier, r.peril): (r.temp_c, r.threshold) for r in species_file().rules}
    assert rules == {
        ("scallop", 1, "HEAT"): (25, 14),
        ("scallop", 2, "HEAT"): (26, 12),
        ("hoya", 1, "HEAT"): (24, 30),
        ("oyster", 1, "BANWEEKS"): (None, 4),
        ("scallop", 1, "BANWEEKS"): (None, 4),
    }
    for r in species_file().rules:
        if r.peril == "HEAT":
            assert (r.window.start, r.window.end) == ("07-01", "09-30")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["species"].pop(),  # a Species without a profile
        lambda d: d["rules"].append(dict(d["rules"][0])),  # duplicate species/tier/peril
        lambda d: d["rules"][0].pop("tempC"),  # HEAT without tempC
        lambda d: d["rules"][3].update(tempC=20),  # BANWEEKS with tempC
        lambda d: d["rules"][0].update(species="tuna"),
        # measured points without a study domain
        lambda d: d["species"][3]["evidence"][0].update(points=[{"x": 25, "y": 0.5}]),
    ],
)
def test_file_validation_rejects(mutate):
    doc = _doc()
    mutate(doc)
    with pytest.raises(ValidationError):
        SpeciesFile.model_validate(doc)


def test_list():
    body = client.get("/species").json()
    assert body["kind"] == "reference"
    assert body["profile_version"] and body["rules_version"]
    scallop = next(s for s in body["species"] if s["id"] == "scallop")
    assert scallop["nameJa"] == "ホタテガイ"
    assert scallop["ruleCount"] == 3
    assert "evidence" not in scallop


def test_detail():
    body = client.get("/species/hoya").json()
    assert body["taxon"] == "Halocynthia roretzi"
    assert [r["tempC"] for r in body["rules"]] == [24]
    assert {e["id"] for e in body["evidence"]} == {"hoya-temperature-size", "hoya-hypoxia"}


def test_rules_filter_by_peril():
    body = client.get("/species/scallop/rules", params={"peril": "HEAT"}).json()
    assert body["species"] == "scallop"
    assert [(r["tier"], r["tempC"], r["threshold"], r["window"]) for r in body["rules"]] == [
        (1, 25, 14, {"start": "07-01", "end": "09-30"}),
        (2, 26, 12, {"start": "07-01", "end": "09-30"}),
    ]
    assert client.get("/species/oyster/rules", params={"peril": "HEAT"}).json()["rules"] == []


@pytest.mark.parametrize("species", ["scallop", "hoya", "oyster"])
def test_responses_report_no_supported_data(species):
    """#47: none of the inspected studies gives measured mortality points for adult farmed stock."""
    body = client.get(f"/species/{species}/responses").json()
    assert body["status"] == "no_supported_data"
    assert body["studies"]
    assert all(s["status"] == "no_supported_data" and s["points"] == [] for s in body["studies"])


def test_responses_filter_by_factor():
    body = client.get("/species/hoya/responses", params={"factor": "dissolved_oxygen"}).json()
    assert [s["id"] for s in body["studies"]] == ["hoya-hypoxia"]
    assert client.get("/species/nori/responses").json()["studies"] == []


@pytest.mark.parametrize("url", ["/species/tuna", "/species/tuna/rules", "/species/tuna/responses"])
def test_unknown_species_is_404(url):
    assert client.get(url).status_code == 404


@pytest.mark.parametrize("url", ["/species/scallop/rules?peril=HEAT25", "/species/scallop/responses?factor=ph"])
def test_invalid_filters_are_422(url):
    assert client.get(url).status_code == 422
