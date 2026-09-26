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
    SELECT p.plot_code, p.origin, ST_AsGeoJSON(p.geom, 7)::json AS geojson,
           p.species, p.operation, p.sea_area_id, p.area_m2,
           ST_X(p.centroid) AS lon, ST_Y(p.centroid) AS lat, pref.name_en AS prefecture
    FROM geo.plots p
    LEFT JOIN geo.sea_areas sa ON sa.id = p.sea_area_id
    LEFT JOIN geo.prefectures pref ON pref.code = sa.prefecture_code
    WHERE p.retired_at IS NULL
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
        prefecture=row["prefecture"],
        source=_SOURCE[row["origin"]],
        centroid_value=(float(row["lon"]), float(row["lat"])),
        area_m2_value=float(row["area_m2"]),
    )


def get(plot_code: str) -> PlotRecord | None:
    with db.connect() as conn:
        row = conn.execute(_SELECT + " AND p.plot_code = %s", (plot_code,)).fetchone()
    return _record(row) if row else None


def query(
    bbox: tuple[float, float, float, float] | None = None,
    species: str | None = None,
) -> list[PlotRecord]:
    sql, params = _SELECT, []
    if bbox:
        sql += " AND ST_Intersects(p.geom, ST_MakeEnvelope(%s, %s, %s, %s, 4326))"
        params += list(bbox)
    if species:
        sql += " AND %s = ANY(p.species)"
        params.append(species)
    with db.connect() as conn:
        rows = conn.execute(sql + " ORDER BY p.plot_code", params).fetchall()
    return [_record(row) for row in rows]
