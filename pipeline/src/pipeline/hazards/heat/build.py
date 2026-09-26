"""Heat jobs (README §9): fetch → layers → per-plot and per-sea-area indices in `out/heat/`, and the readers the API uses.

    out/heat/layers/<region>/...                 gridded layers (core.layers)
    out/heat/indices/<zone>/<season>.json        GET /heat/indices/{zone}/{season}
    out/heat/plots/<plot>/<season>.json          GET /heat/plots/{plot}/risk?season=
"""

import hashlib
import json
import logging
import os
import tempfile
from datetime import date
from pathlib import Path

from pydantic import ValidationError
from shapely.geometry import box
from shapely.geometry.base import BaseGeometry

from pipeline.core.clients.jaxa_earth import fetch as jaxa_fetch
from pipeline.core.config import out_dir
from pipeline.core.grid import Grid
from pipeline.core.layers import days, months, region_for
from pipeline.core.plots import store
from pipeline.core.regions import REGIONS, Region, sea_area_of, sea_areas
from pipeline.core.schemas import IndicesResponse, PlotSummary, Window

from . import MODULE, MODULE_VERSION
from .indices import compute, to_series
from .layers import DAILY, MONTHLY, build_day, build_month, season_of, season_window
from .schemas import HeatRiskResponse

log = logging.getLogger(__name__)


def fetch(start: date, end: date, region: Region, *, refresh: bool = False) -> dict[str, int]:
    """Pin every heat input for [start, end] without building layers. Returns files pinned per layer."""
    bbox = Grid.snap(region.bbox).bbox
    counts: dict[str, int] = {}
    for day in days(start, end):
        for spec in DAILY:
            counts[spec.name] = counts.get(spec.name, 0) + len(jaxa_fetch(spec.coll, day, bbox, MODULE, refresh=refresh))
    for m in months(start, end):
        for spec in MONTHLY:
            counts[spec.name] = counts.get(spec.name, 0) + len(jaxa_fetch(spec.coll, m, bbox, MODULE, refresh=refresh))
    return counts


def build(start: date, end: date, region: Region, *, offline: bool = False, force: bool = False, months_only: bool = False) -> dict:
    """Build layers for [start, end] (fetching missing inputs unless offline), then rewrite the affected seasons' outputs."""
    built: dict[str, int] = {}
    missing: dict[str, list[str]] = {}

    def tally(when: date, result: dict[str, Path | None]) -> None:
        for name, path in result.items():
            if path:
                built[name] = built.get(name, 0) + 1
            else:
                missing.setdefault(name, []).append(when.isoformat())

    if not months_only:
        for day in days(start, end):
            tally(day, build_day(day, region, offline=offline, force=force))
    for m in months(start, end):
        tally(m, build_month(m, region, offline=offline, force=force))

    seasons = sorted({s for d in days(start, end) if (s := season_of(d))})
    outputs = {s: write_outputs(s, region) for s in seasons}
    return {"built": built, "missing": {k: len(v) for k, v in missing.items()}, "seasons": outputs}


def _summary(geom: BaseGeometry, plot_code: str | None = None, sea_area: str | None = None) -> PlotSummary:
    c = geom.centroid
    return PlotSummary(
        plot_code=plot_code,
        area_m2=store.area_m2(geom),
        centroid=(round(c.x, 6), round(c.y, 6)),
        sea_area=sea_area or sea_area_of(geom),
    )


def geometry_fingerprint(geom: BaseGeometry) -> str:
    return hashlib.sha256(geom.normalize().wkb).hexdigest()


def _write(path: Path, model, geometry: BaseGeometry | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = model.model_dump(mode="json", by_alias=True)
    if geometry is not None:
        payload["_geometry_sha256"] = geometry_fingerprint(geometry)
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=path.name, suffix=".part", delete=False) as output:
            tmp = Path(output.name)
            output.write(json.dumps(payload, ensure_ascii=False) + "\n")
            output.flush()
            os.fsync(output.fileno())
        tmp.replace(path)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def zone_indices(zone_id: str, season: str, region: Region) -> IndicesResponse:
    start, end = season_window(season)
    values = compute(sea_areas()[zone_id].geometry, region, start, end)
    return IndicesResponse(module=MODULE, module_version=MODULE_VERSION, zone=zone_id, season=season, series=to_series(values))


def plot_risk(plot: store.PlotRecord, season: str, region: Region) -> HeatRiskResponse:
    start, end = season_window(season)
    return HeatRiskResponse(
        module=MODULE,
        module_version=MODULE_VERSION,
        plot=_summary(plot.geometry, plot.plot_code, plot.sea_area),
        window=Window(start=start, end=end),
        indices=compute(plot.geometry, region, start, end),
    )


def write_outputs(season: str, region: Region) -> dict[str, int]:
    """Precompute season outputs for every sea area and plot inside the region."""
    area = box(*region.bbox)
    root = out_dir(MODULE)
    zones = [z for z in sea_areas().values() if area.contains(z.geometry)]
    plots = [p for p in store.query_all(region.bbox) if area.contains(p.geometry)]
    for z in zones:
        _write(root / "indices" / z.id / f"{season}.json", zone_indices(z.id, season, region))
    for p in plots:
        _write(root / "plots" / p.plot_code / f"{season}.json", plot_risk(p, season, region), p.geometry)
    log.info("heat %s %s: %d zones, %d plots", region.id, season, len(zones), len(plots))
    return {"zones": len(zones), "plots": len(plots)}


def cache_plot_risk(plot: store.PlotRecord, season: str, response: HeatRiskResponse) -> None:
    _write(out_dir(MODULE) / "plots" / plot.plot_code / f"{season}.json", response, plot.geometry)


def read_zone_indices(zone_id: str, season: str) -> IndicesResponse | None:
    path = out_dir(MODULE) / "indices" / zone_id / f"{season}.json"
    return IndicesResponse.model_validate_json(path.read_text()) if path.exists() else None


def read_plot_risk(plot_code: str, season: str, plot: store.PlotRecord | None = None) -> HeatRiskResponse | None:
    path = out_dir(MODULE) / "plots" / plot_code / f"{season}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
        if not isinstance(payload, dict):
            return None
        fingerprint = payload.pop("_geometry_sha256", None)
        if plot is not None and fingerprint != geometry_fingerprint(plot.geometry):
            return None
        response = HeatRiskResponse.model_validate(payload)
        start, end = season_window(season)
        if response.plot.plot_code != plot_code or response.window.start != start or response.window.end != end:
            return None
        if plot is not None and response.plot != _summary(plot.geometry, plot.plot_code, plot.sea_area):
            return None
        return response
    except (OSError, ValueError, ValidationError):
        return None


class NotBuilt(LookupError):
    pass


def risk(geom: BaseGeometry, start: date, end: date, t: float | None = None) -> HeatRiskResponse:
    """POST /heat/risk: sample built layers for any polygon (no satellite calls)."""
    region = region_for(MODULE, geom)
    if region is None:
        raise NotBuilt(f"no heat layers are built for this location (build regions: {', '.join(REGIONS)})")
    return HeatRiskResponse(
        module=MODULE,
        module_version=MODULE_VERSION,
        plot=_summary(geom),
        window=Window(start=start, end=end),
        indices=compute(geom, region, start, end, t),
    )
