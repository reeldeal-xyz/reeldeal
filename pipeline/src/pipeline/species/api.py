"""Species router (README §5a, §11): profiles, response evidence and trigger rules, served from data/ref/species.json.

Reference values only. The pipeline never applies a rule or turns evidence into a prediction: responses are
measured study points (none yet, so every study reports `no_supported_data`), never fitted curves.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import Field

from pipeline.core.schemas import Model, ModuleName, Species
from pipeline.core.species import (
    Evidence,
    Factor,
    Peril,
    ResponseStatus,
    Rule,
    SpeciesGroup,
    SpeciesProfile,
    species_file,
)

router = APIRouter(prefix="/species", tags=["species"])

Kind = Literal["reference"]


class Versioned(Model):
    kind: Kind = "reference"
    profile_version: str = Field(alias="profile_version")
    rules_version: str = Field(alias="rules_version")


class SpeciesSummary(Model):
    id: Species
    name: str
    name_ja: str
    group: SpeciesGroup
    taxon: str
    hazards: list[ModuleName]
    evidence_count: int
    rule_count: int


class SpeciesList(Versioned):
    species: list[SpeciesSummary]


class SpeciesDetail(Versioned, SpeciesProfile):
    rules: list[Rule]


class SpeciesRules(Model):
    kind: Kind = "reference"
    species: Species
    rules_version: str = Field(alias="rules_version")
    rules: list[Rule]


class SpeciesResponses(Model):
    kind: Kind = "reference"
    species: Species
    profile_version: str = Field(alias="profile_version")
    factor: Factor | None
    status: ResponseStatus = Field(description="measured when at least one study has measured points")
    studies: list[Evidence]


def _profile(species: str) -> SpeciesProfile:
    if (profile := species_file().profile(species)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"unknown species {species!r}")
    return profile


@router.get("", response_model=SpeciesList)
def list_species() -> SpeciesList:
    """Every species profile, with the versions of the profiles and of the rules."""
    f = species_file()
    return SpeciesList(
        profile_version=f.profile_version,
        rules_version=f.rules_version,
        species=[
            SpeciesSummary(
                **dict(s),
                evidence_count=len(s.evidence),
                rule_count=len(f.rules_for(s.id)),
            )
            for s in f.species
        ],
    )


@router.get("/{species}", response_model=SpeciesDetail)
def species_detail(species: str) -> SpeciesDetail:
    """One species: profile, response evidence (study domain and status) and its trigger rules."""
    f = species_file()
    profile = _profile(species)
    return SpeciesDetail(
        **dict(profile),
        profile_version=f.profile_version,
        rules_version=f.rules_version,
        rules=f.rules_for(profile.id),
    )


@router.get("/{species}/rules", response_model=SpeciesRules)
def species_rules(species: str, peril: Peril | None = None) -> SpeciesRules:
    """The app's trigger rules for a species (thresholds, tiers, windows). Reference only: never evaluated here."""
    f = species_file()
    profile = _profile(species)
    return SpeciesRules(species=profile.id, rules_version=f.rules_version, rules=f.rules_for(profile.id, peril))


@router.get("/{species}/responses", response_model=SpeciesResponses)
def species_responses(species: str, factor: Factor | None = None) -> SpeciesResponses:
    """Measured response points per study, with the study's domain. No fitted curves and no farm predictions."""
    f = species_file()
    profile = _profile(species)
    studies = [e for e in profile.evidence if factor is None or factor in e.factors]
    return SpeciesResponses(
        species=profile.id,
        profile_version=f.profile_version,
        factor=factor,
        status="measured" if any(e.points for e in studies) else "no_supported_data",
        studies=studies,
    )
