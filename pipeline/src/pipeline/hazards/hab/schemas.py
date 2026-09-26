"""HAB module request/response models (README §7)."""

from datetime import date
from typing import Literal

from pydantic import Field

from pipeline.core.schemas import AdvisoryValue, IndexValue, Model, RiskEnvelope, RiskRequestBase, Species

HAB_INDEX_PATTERN = r"^(BANWEEKS|BAN_ACTIVE|REDTIDE_DAYS|CHL|CHL_Z|MLD)$"

Toxin = Literal["PSP", "DSP"]


class HabIndexValue(IndexValue):
    index: str = Field(pattern=HAB_INDEX_PATTERN, examples=["BANWEEKS"])
    species: Species | None = Field(default=None, description="Set for BANWEEKS / BAN_ACTIVE")
    toxin: Toxin | None = Field(default=None, description="Set for BAN_ACTIVE")


class HabRiskRequest(RiskRequestBase):
    species: Species


class HabRiskResponse(RiskEnvelope):
    indices: list[HabIndexValue]


class BanInterval(Model):
    """One normalized shellfish toxin restriction interval (hab-bans.csv row)."""

    pref: str
    sea_area: str
    species: Species
    toxin: Toxin
    level: str = Field(description="The prefecture's own restriction category, as published")
    restricted_from: date
    lifted_on: date | None
    source_url: str
    sha256: str
    confidence: Literal["high", "medium", "low"]


class RedTideEvent(Model):
    pref: str
    sea_area: str
    organism: str = Field(examples=["Karenia mikimotoi"])
    start: date
    end: date | None
    fish_kill: bool | None
    source_url: str
    sha256: str


class HabForecast(Model):
    zone: str
    module_version: str = Field(alias="module_version")
    issued: date
    advisory: list[AdvisoryValue] = Field(description="hab-onset probabilities for 1-4 week horizons")
