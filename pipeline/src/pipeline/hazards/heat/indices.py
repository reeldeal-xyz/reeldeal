"""Heat indices (README §6): SST, SST_ANOM, SST_MONTH, and the request-only HEAT{t}.

Conventions (README Q10, proposed; to be agreed with the app owner before REFERENCE_FIRES is re-derived):
- Day: JAXA's L3 daily file date. SGLI nighttime passes over Japan are ~20:45 JST on that date.
- Gap fill: SGLI night → SGLI day → AMSR2 night → null, per plot and day, recorded in `source` and `pixels`.
- Aggregation: median of the extracted pixels. Values are rounded to 3 decimals (SGLI's DN step is 0.0012 °C).
- Days with no built layer are omitted; a built day with no valid pixel in reach is a null value.

Values only: nothing here compares a value to a payout threshold.
"""

import calendar
from dataclasses import dataclass
from datetime import date

from shapely.geometry.base import BaseGeometry

from pipeline.core.extract import Extraction, Extractor
from pipeline.core.grid import Layer
from pipeline.core.layers import LayerSpec, days, load, months
from pipeline.core.pin import combined_sha256
from pipeline.core.regions import Region
from pipeline.core.schemas import IndexPoint, IndexSeries, Pixels, Source

from . import MODULE
from .schemas import HeatIndexValue
from .sources.cobe_normal import COBE_NORMAL
from .sources.jaxa_sst import DAILY_ORDER, SGLI_NIGHT_MONTHLY

UNIT = "degC"


def heat_index_name(t: float) -> str:
    """HEAT{t}: `HEAT25` for 25 °C, `HEAT25.5` for 25.5 °C."""
    return f"HEAT{t:g}"


@dataclass
class Sampled:
    value: float
    spec: LayerSpec
    layer: Layer
    extraction: Extraction

    @property
    def source(self) -> Source:
        return Source(product=self.spec.product, sha256=self.layer.meta["sha256"])

    @property
    def pixels(self) -> Pixels:
        e = self.extraction
        return Pixels(strategy=e.strategy, count=e.count, product=self.spec.product, distance_km=e.distance_km)


class Sampler:
    """Samples a region's layers for one geometry, reusing extraction masks across days."""

    def __init__(self, geom: BaseGeometry, region: Region):
        self.geom = geom
        self.region = region
        self._extractors: dict[tuple[str, tuple], Extractor] = {}

    def _extractor(self, spec: LayerSpec, layer: Layer) -> Extractor:
        key = (spec.name, (layer.grid.west, layer.grid.north, layer.grid.shape))
        if key not in self._extractors:
            self._extractors[key] = Extractor(self.geom, layer.grid, spec.nearest_max_km)
        return self._extractors[key]

    def sample(self, spec: LayerSpec, when: date) -> tuple[bool, Sampled | None]:
        """(layer exists, sampled value or None)."""
        layer = load(MODULE, self.region.id, spec, when)
        if layer is None:
            return False, None
        e = self._extractor(spec, layer).extract(layer.data)
        return True, (Sampled(round(e.value, 3), spec, layer, e) if e else None)

    def sst(self, day: date) -> tuple[bool, Sampled | None]:
        """Daily SST in gap-fill order. (any product built for the day, first valid sample)."""
        built = False
        for spec in DAILY_ORDER:
            exists, s = self.sample(spec, day)
            built |= exists
            if s:
                return True, s
        return built, None


def _value(index: str, as_of: date, s: Sampled | None) -> HeatIndexValue:
    return HeatIndexValue(
        index=index,
        unit=UNIT,
        value=s.value if s else None,
        as_of=as_of,
        source=s.source if s else None,
        pixels=s.pixels if s else None,
    )


def compute(geom: BaseGeometry, region: Region, start: date, end: date, t: float | None = None) -> list[HeatIndexValue]:
    """Every heat index for a geometry over [start, end], from built layers only."""
    sampler = Sampler(geom, region)
    sst: list[HeatIndexValue] = []
    anom: list[HeatIndexValue] = []
    for day in days(start, end):
        built, s = sampler.sst(day)
        if not built:
            continue
        sst.append(_value("SST", day, s))
        normal_built, n = sampler.sample(COBE_NORMAL, day)
        if not normal_built:
            continue
        if s and n:
            anom.append(
                HeatIndexValue(
                    index="SST_ANOM",
                    unit=UNIT,
                    value=round(s.value - n.value, 3),
                    as_of=day,
                    source=Source(
                        product=f"{s.spec.product}-minus-{n.spec.product}",
                        sha256=combined_sha256([s.layer.meta["sha256"], n.layer.meta["sha256"]]),
                    ),
                    pixels=s.pixels,
                )
            )
        else:
            anom.append(HeatIndexValue(index="SST_ANOM", unit=UNIT, value=None, as_of=day, source=None))

    monthly: list[HeatIndexValue] = []
    for m in months(start, end):
        built, s = sampler.sample(SGLI_NIGHT_MONTHLY, m)
        if built:
            month_end = m.replace(day=calendar.monthrange(m.year, m.month)[1])
            monthly.append(_value("SST_MONTH", month_end, s))

    out = sst + anom + monthly
    if t is not None and sst:
        hot = [v for v in sst if v.value is not None and v.value >= t]
        valued = [v for v in sst if v.source is not None]
        out.append(
            HeatIndexValue(
                index=heat_index_name(t),
                unit="days",
                value=float(len(hot)),
                as_of=sst[-1].as_of,
                source=Source(
                    product="+".join(sorted({v.source.product for v in valued})),
                    sha256=combined_sha256([v.source.sha256 for v in valued]),
                )
                if valued
                else None,
            )
        )
    return out


def to_series(values: list[HeatIndexValue]) -> list[IndexSeries]:
    """Group per-day values into one series per index (for GET /heat/indices)."""
    series: dict[str, IndexSeries] = {}
    for v in values:
        s = series.setdefault(v.index, IndexSeries(index=v.index, unit=v.unit, points=[]))
        s.points.append(IndexPoint(date=v.as_of, value=v.value, source=v.source, pixels=v.pixels))
    return list(series.values())
