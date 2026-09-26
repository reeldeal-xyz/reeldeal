"""Heat module request/response models (README §6)."""

from datetime import date

from pydantic import Field

from pipeline.core.schemas import (
    AdvisoryValue,
    IndexValue,
    Model,
    RiskEnvelope,
    RiskRequestBase,
)

# SST, SST_ANOM, SST_MONTH, MHW_DAYS, MHW_INTENSITY, T_D{z} (gear depth, m) and HEAT{t} (request-only convenience).
HEAT_INDEX_PATTERN = r"^(SST|SST_ANOM|SST_MONTH|MHW_DAYS|MHW_INTENSITY|T_D\d+|HEAT\d+(\.\d+)?)$"


class HeatIndexValue(IndexValue):
    index: str = Field(pattern=HEAT_INDEX_PATTERN, examples=["SST"])


class HeatRiskRequest(RiskRequestBase):
    t: float | None = Field(
        default=None,
        description="If set, also return HEAT{t}: days with SST >= t degC in the window. Never stored.",
    )


class HeatRiskResponse(RiskEnvelope):
    indices: list[HeatIndexValue]


class HeatForecast(Model):
    plot: str
    module_version: str = Field(alias="module_version")
    issued: date
    advisory: list[AdvisoryValue]


class HeatClimatology(Model):
    zone: str
    module_version: str = Field(alias="module_version")
    period: tuple[date, date]
    sst_trend_deg_c_per_decade: float | None
    mhw_events_per_year: float | None
    mhw_mean_duration_days: float | None
    sources: list[str]
