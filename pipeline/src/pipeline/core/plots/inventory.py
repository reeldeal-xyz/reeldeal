"""Live plot inventory from PostGIS.

When DATABASE_URL is configured, geo.plots is authoritative for current geometry, including the
fishery-right polygons that replace the old p1213-* synthetic seed discs. The seed GeoJSON remains a
DB-less fallback in store.py; this module never silently falls back.
"""

import json

from shapely.geometry import shape

from pipeline.core import db

from .store import PlotRecord

_SOURCE = {
    "msil": "msil",
    "upload": "upload",
    "synthetic": "demo",
    "fishery_right": "fishery_right",
}

_SELECT = """
    SELECT plot_code, origin, ST_AsGeoJSON(geom, 7)::json AS geojson,
           species, operation, sea_area_id
    FROM geo.plots
    WHERE retired_at IS NULL
"""


def _record(row: dict) -> PlotRecord:
    geojson = row["geojson"] if isinstance(row["geojson"], dict) else json.loads(row["geojson"])
    return PlotRecord(
        plot_code=row["plot_code"],
        geometry=shape(geojson),
        geojson=geojson,
        species=tuple(row["species"] or ()),
        operation=row["operation"],
        sea_area=row["sea_area_id"],
        prefecture=None,
        source=_SOURCE[row["origin"]],
    )


def get(plot_code: str) -> PlotRecord | None:
    with db.connect() as conn:
        row = conn.execute(_SELECT + " AND plot_code = %s", (plot_code,)).fetchone()
    return _record(row) if row else None


def query(
    bbox: tuple[float, float, float, float] | None = None,
    species: str | None = None,
) -> list[PlotRecord]:
    sql, params = _SELECT, []
    if bbox:
        sql += " AND ST_Intersects(geom, ST_MakeEnvelope(%s, %s, %s, %s, 4326))"
        params += list(bbox)
    if species:
        sql += " AND %s = ANY(species)"
        params.append(species)
    with db.connect() as conn:
        rows = conn.execute(sql + " ORDER BY plot_code", params).fetchall()
    return [_record(row) for row in rows]
