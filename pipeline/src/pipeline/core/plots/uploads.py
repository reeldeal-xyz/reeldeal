"""Uploaded plots (`POST /plots`), stored in PostGIS `geo.plots` with origin 'upload' (db/README.md).

Write side only: reads of every origin, uploads included, go through `inventory.py`.

The database requires uploaded codes to start with `upload:`, so a submitted code gets that prefix; it can never
collide with a surveyed or seeded plot. Geometry is stored as a MultiPolygon in EPSG:4326; area and centroid are
computed by the database, but responses use the same local equirectangular area as the seed (store.area_m2).
"""

import json

import psycopg
from shapely.geometry.base import BaseGeometry

from pipeline.core import db
from pipeline.core.regions import sea_area_of

from .inventory import _record
from .store import PlotRecord

PREFIX = "upload:"


class DuplicatePlot(ValueError):
    pass


def code_of(plot_code: str) -> str:
    return plot_code if plot_code.startswith(PREFIX) else PREFIX + plot_code


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
                RETURNING plot_code, origin, ST_AsGeoJSON(geom, 7)::json AS geojson, species, operation, sea_area_id
                """,
                (code, json.dumps(geojson), species, operation, zone),
            ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise DuplicatePlot(f"plot {code!r} already exists") from None
    return _record(row)
