"""Species reference data (README §5a): profiles, response evidence and the app's trigger rules.

`data/ref/species.json` is canonical; `packages/shared/src/species.data.json` is generated from it
(`bun run species:gen`). The pipeline serves these values and never evaluates them: the app counts days
against `rules` itself (`heatDays` / `heatFiredOn` in packages/shared/src/rules.ts).
"""

from functools import cache
from pathlib import Path
from typing import Literal, get_args

from pydantic import Field, computed_field, model_validator

from pipeline.core.config import ref_dir
from pipeline.core.schemas import Model, ModuleName, Species

SpeciesGroup = Literal["seaweed", "shellfish", "finfish"]
Factor = Literal["temperature", "salinity", "dissolved_oxygen", "density"]
Peril = Literal["HEAT", "BANWEEKS"]
ResponseStatus = Literal["measured", "no_supported_data"]


class TestedRange(Model):
    min: float
    max: float
    unit: str


class ResponsePoint(Model):
    """One measured value from a study. Never a fitted or interpolated value."""

    x: float
    y: float
    y_err: float | None = None
    n: int | None = Field(default=None, gt=0)


class Evidence(Model):
    """One study and the domain it supports: taxon (the profile's), life stage, size, exposure, endpoint, tested range."""

    id: str
    url: str
    factors: list[Factor] = Field(min_length=1)
    access: Literal["abstract", "full_text"] | None = Field(
        description="How much of the study was inspected; null if unrecorded"
    )
    life_stage: str | None = None
    size: str | None = None
    exposure: str | None = None
    endpoint: str | None = None
    tested_range: TestedRange | None = None
    x_unit: str | None = None
    y_unit: str | None = None
    points: list[ResponsePoint] = Field(default_factory=list)
    note: str | None = None

    @computed_field
    @property
    def status(self) -> ResponseStatus:
        return "measured" if self.points else "no_supported_data"

    @model_validator(mode="after")
    def _points_need_a_domain(self) -> "Evidence":
        if self.points and None in (self.life_stage, self.endpoint, self.tested_range, self.x_unit, self.y_unit):
            raise ValueError(f"{self.id}: measured points need life stage, endpoint, tested range and units")
        return self


class Window(Model):
    start: str = Field(pattern=r"^\d{2}-\d{2}$", description="MM-DD, inclusive")
    end: str = Field(pattern=r"^\d{2}-\d{2}$", description="MM-DD, inclusive")


class Rule(Model):
    """A trigger rule, as the app applies it (packages/shared RULES). Served for reference; never evaluated here."""

    species: Species
    tier: Literal[1, 2]
    peril: Peril
    temp_c: int | None = Field(default=None, ge=0, le=255, description="HEAT only: a day counts when SST >= tempC")
    threshold: int = Field(gt=0, description="Days at or above tempC for HEAT; consecutive weeks for BANWEEKS")
    window: Window | None = Field(default=None, description="HEAT only: season window")

    @model_validator(mode="after")
    def _peril_fields(self) -> "Rule":
        heat = self.peril == "HEAT"
        if heat != (self.temp_c is not None) or heat != (self.window is not None):
            raise ValueError(f"{self.species} tier {self.tier}: HEAT rules need tempC and window, other perils neither")
        return self


class SpeciesProfile(Model):
    id: Species
    name: str
    name_ja: str
    group: SpeciesGroup
    taxon: str
    hazards: list[ModuleName]
    evidence: list[Evidence]


class SpeciesFile(Model):
    profile_version: str = Field(alias="profile_version")
    rules_version: str = Field(alias="rules_version")
    species: list[SpeciesProfile]
    rules: list[Rule]

    @model_validator(mode="after")
    def _consistent(self) -> "SpeciesFile":
        ids = [s.id for s in self.species]
        if sorted(ids) != sorted(get_args(Species)):
            raise ValueError("species.json must list every Species exactly once")
        keys = [(r.species, r.tier, r.peril) for r in self.rules]
        if len(set(keys)) != len(keys):
            raise ValueError("duplicate rule for a species, tier and peril")
        return self

    def profile(self, species_id: str) -> SpeciesProfile | None:
        return next((s for s in self.species if s.id == species_id), None)

    def rules_for(self, species_id: str, peril: Peril | None = None) -> list[Rule]:
        return [r for r in self.rules if r.species == species_id and peril in (None, r.peril)]


@cache
def _load(path: Path) -> SpeciesFile:
    return SpeciesFile.model_validate_json(path.read_bytes())


def species_file() -> SpeciesFile:
    return _load(ref_dir() / "species.json")
