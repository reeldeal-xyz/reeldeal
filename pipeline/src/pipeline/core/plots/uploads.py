"""Uploaded plots (`POST /plots`), stored in PostGIS `geo.plots` with origin 'upload' (db/README.md).

The database requires uploaded codes to start with `upload:`, so a submitted code gets that prefix; it can never
collide with a surveyed or seeded plot. Geometry is stored as a MultiPolygon in EPSG:4326; area and centroid are
computed by the database, but responses use the same local equirectangular area as the seed (store.area_m2).
"""

import json

import psycopg
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

from pipeline.core import db
from pipeline.core.regions import sea_area_of

from .store import PlotRecord

PREFIX = "upload:"


class DuplicatePlot(ValueError):
    pass


def code_of(plot_code: str) -> str:
    return plot_code if plot_code.startswith(PREFIX) else PREFIX + plot_code


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
        source="upload",
    )


_SELECT = """
    SELECT plot_code, ST_AsGeoJSON(geom, 7)::json AS geojson, species, operation, sea_area_id
    FROM geo.plots
    WHERE origin = 'upload' AND retired_at IS NULL
"""


def insert(plot_code: str, geom: BaseGeometry, geojson: dict, species: list[str], operation: str) -> PlotRecord:
    code = code_of(plot_code)
    zone = sea_area_of(geom)
    try:
        with db.connect() as conn:
            row = conn.execute(
                """
                INSERT INTO geo.plots (plot_code, origin, geom, species, operation, sea_area_id)
                VALUES (%s, 'upload', ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), %s, %s,
                        (SELECT id FROM geo.sea_areas WHERE id = %s))
                RETURNING plot_code, ST_AsGeoJSON(geom, 7)::json AS geojson, species, operation, sea_area_id
                """,
                (code, json.dumps(geojson), species, operation, zone),
            ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise DuplicatePlot(f"plot {code!r} already exists") from None
    return _record(row)


def get(plot_code: str) -> PlotRecord | None:
    if not plot_code.startswith(PREFIX):
        return None
    with db.connect() as conn:
        row = conn.execute(_SELECT + " AND plot_code = %s", (plot_code,)).fetchone()
    return _record(row) if row else None


def query(bbox: tuple[float, float, float, float] | None = None, species: str | None = None) -> list[PlotRecord]:
    sql, params = _SELECT, []
    if bbox:
        sql += " AND ST_Intersects(geom, ST_MakeEnvelope(%s, %s, %s, %s, 4326))"
        params += list(bbox)
    if species:
        sql += " AND %s = ANY(species)"
        params.append(species)
    with db.connect() as conn:
        rows = conn.execute(sql + " ORDER BY plot_code", params).fetchall()
    return [_record(r) for r in rows]
