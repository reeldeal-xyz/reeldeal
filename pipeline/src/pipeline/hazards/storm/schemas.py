"""Storm module request/response models (README §8)."""

from datetime import date, datetime
from typing import Literal

from pydantic import Field

from pipeline.core.schemas import AdvisoryValue, IndexValue, Model, Operation, RiskEnvelope, RiskRequestBase

# HS_HOURS{h}: hours with Hs >= h m; h is an index parameter, not a payout level.
STORM_INDEX_PATTERN = (
    r"^(MAX_SURGE|MAX_WATER_LEVEL|MAX_HS|HS_HOURS\d+(\.\d+)?|MAX_WAVE_POWER|MAX_CURRENT|MAX_WIND|TC_DIST)$"
)


class StormIndexValue(IndexValue):
    index: str = Field(pattern=STORM_INDEX_PATTERN, examples=["MAX_HS"])
    event: str | None = Field(default=None, description="Storm event id for event indices; null for daily indices")


class StormRiskRequest(RiskRequestBase):
    gear: Operation
    h: float | None = Field(default=None, description="If set, also return HS_HOURS{h}")


class StormRiskResponse(RiskEnvelope):
    indices: list[StormIndexValue]


class StormEvent(Model):
    event_id: str
    kind: Literal["typhoon", "extratropical"]
    name: str | None = None
    jma_number: str | None = Field(default=None, description="e.g. 2519 for typhoon no. 19 of 2025")
    start: datetime
    end: datetime
    min_pressure_hpa: float | None = None


class ZoneImpact(Model):
    sea_area: str
    indices: list[StormIndexValue]


class StormImpact(Model):
    event: StormEvent
    module_version: str = Field(alias="module_version")
    zones: list[ZoneImpact]


class StormForecast(Model):
    plot: str
    module_version: str = Field(alias="module_version")
    issued: date
    advisory: list[AdvisoryValue] = Field(description="storm-nowcast and storm-damage values")
