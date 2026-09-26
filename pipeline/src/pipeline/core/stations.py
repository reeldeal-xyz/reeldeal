"""Station registry and observations (README §5), stored in PostGIS (`geo.stations`, `risk.station_observations`).

`data/ref/stations.json` is the reviewed registry; `pipeline stations build` upserts every station with a published
position and loads its pinned observations through the station's adapter. Positions are never guessed, so a
registry entry without lat/lon is reported and skipped. The routes read the database only.
"""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pipeline.core import db
from pipeline.core.config import data_dir, ref_dir
from pipeline.core.schemas import Station, StationPoint, StationSeries

JST = ZoneInfo("Asia/Tokyo")

# Variable -> unit. WT: water temperature at the station's depth.
UNITS = {"WT": "degC"}


@dataclass(frozen=True)
class Observation:
    variable: str
    depth_m: float
    observed_at: datetime
    value: float | None
    qc_flag: str | None
    sha256: str


def registry(path: Path | None = None) -> list[dict]:
    return json.loads((path or ref_dir() / "stations.json").read_text())["stations"]


# --- adapters -------------------------------------------------------------------


def futatsune(entry: dict, buoy_dir: Path | None = None) -> Iterator[Observation]:
    """Kesennuma Fisheries Experimental Station CSVs: `YYYY/MM/DD HH:MM:SS<TAB>°C<TAB>flag`, JST, 30-min, 3 m."""
    buoy_dir = buoy_dir or data_dir() / "buoy"
    pins = {s["file"]: s["sha256"] for s in json.loads((buoy_dir / "sources.json").read_text())["buoy"]}
    for name, sha in sorted(pins.items()):
        for line in (buoy_dir / name).read_text().splitlines():
            if not line.strip():
                continue
            t, value, flag = line.split("\t")
            yield Observation(
                variable="WT",
                depth_m=float(entry["depthM"]),
                observed_at=datetime.strptime(t, "%Y/%m/%d %H:%M:%S").replace(tzinfo=JST),
                value=float(value) if value.strip() else None,
                qc_flag=flag.strip() or None,
                sha256=sha,
            )


ADAPTERS = {"futatsune": futatsune}


# --- load -----------------------------------------------------------------------


def load(conn, entries: list[dict], observations=None) -> dict:
    """Upsert stations with a position and their observations. `observations(entry)` overrides the adapter (tests)."""
    loaded, skipped = {}, {}
    for e in entries:
        if e.get("lat") is None or e.get("lon") is None:
            skipped[e["stationId"]] = "no published position"
            continue
        obs = list((observations or ADAPTERS[e["adapter"]])(e))
        times = [o.observed_at for o in obs]
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO geo.stations (id, name, source, type, geom, prefecture_code, sea_area_id, variables,
                                          cadence, url, first_obs, last_obs)
                VALUES (%s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326),
                        (SELECT code FROM geo.prefectures WHERE code = %s),
                        (SELECT id FROM geo.sea_areas WHERE id = %s), %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                  name = EXCLUDED.name, source = EXCLUDED.source, type = EXCLUDED.type, geom = EXCLUDED.geom,
                  prefecture_code = EXCLUDED.prefecture_code, sea_area_id = EXCLUDED.sea_area_id,
                  variables = EXCLUDED.variables, cadence = EXCLUDED.cadence, url = EXCLUDED.url,
                  first_obs = LEAST(geo.stations.first_obs, EXCLUDED.first_obs),
                  last_obs = GREATEST(geo.stations.last_obs, EXCLUDED.last_obs)
                """,
                (
                    e["stationId"],
                    e["name"],
                    e["source"],
                    e["type"],
                    e["lon"],
                    e["lat"],
                    e.get("prefecture"),
                    e.get("seaArea"),
                    e["variables"],
                    e.get("cadence"),
                    e.get("url"),
                    min(times, default=None),
                    max(times, default=None),
                ),
            )
            cur.executemany(
                """
                INSERT INTO risk.station_observations
                  (station_id, variable, depth_m, observed_at, value, qc_flag, source_sha256)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (station_id, variable, depth_m, observed_at) DO UPDATE SET
                  value = EXCLUDED.value, qc_flag = EXCLUDED.qc_flag, source_sha256 = EXCLUDED.source_sha256
                """,
                [(e["stationId"], o.variable, o.depth_m, o.observed_at, o.value, o.qc_flag, o.sha256) for o in obs],
            )
        loaded[e["stationId"]] = len(obs)
    return {"loaded": loaded, "skipped": skipped}


def build() -> dict:
    """`pipeline stations build`: load the reviewed registry (skipped while DATABASE_URL is unset)."""
    entries = registry()
    if not db.configured():
        return {"registry": len(entries), "skipped": "DATABASE_URL is not set"}
    with db.connect() as conn:
        return {"registry": len(entries), **load(conn, entries)}


# --- read -----------------------------------------------------------------------


def stations(bbox: tuple[float, float, float, float] | None = None, type: str | None = None) -> list[Station]:
    sql = """
        SELECT id AS station_id, name, source, type, ST_Y(geom) AS lat, ST_X(geom) AS lon,
               prefecture_code AS prefecture, sea_area_id AS sea_area, variables, cadence, url, first_obs, last_obs
        FROM geo.stations WHERE true
    """
    params: list = []
    if bbox:
        sql += " AND ST_Intersects(geom, ST_MakeEnvelope(%s, %s, %s, %s, 4326))"
        params += list(bbox)
    if type:
        sql += " AND type = %s"
        params.append(type)
    with db.connect() as conn:
        rows = conn.execute(sql + " ORDER BY id", params).fetchall()
    return [Station.model_validate({**r, "cadence": r["cadence"] or ""}) for r in rows]


class UnknownStation(LookupError):
    pass


def series(
    station_id: str, var: str, start: datetime | None = None, end: datetime | None = None, depth_m: float | None = None
) -> StationSeries:
    """Observations of one variable, oldest first. Several depths need `depth_m` to pick one (ValueError otherwise)."""
    with db.connect() as conn:
        if conn.execute("SELECT 1 FROM geo.stations WHERE id = %s", (station_id,)).fetchone() is None:
            raise UnknownStation(station_id)
        depths = [
            float(r["depth_m"])
            for r in conn.execute(
                "SELECT DISTINCT depth_m FROM risk.station_observations WHERE station_id = %s AND variable = %s ORDER BY 1",
                (station_id, var),
            ).fetchall()
        ]
        if depth_m is None and len(depths) > 1:
            raise ValueError(f"{station_id} has {var} at several depths {depths}; pass depth")
        depth = depth_m if depth_m is not None else (depths[0] if depths else None)
        rows = conn.execute(
            """
            SELECT observed_at AS t, value, source_sha256 FROM risk.station_observations
            WHERE station_id = %s AND variable = %s AND depth_m = %s
              AND (%s::timestamptz IS NULL OR observed_at >= %s) AND (%s::timestamptz IS NULL OR observed_at <= %s)
            ORDER BY observed_at
            """,
            (station_id, var, depth, start, start, end, end),
        ).fetchall()
    return StationSeries(
        station_id=station_id,
        var=var,
        unit=UNITS.get(var, ""),
        depth_m=depth,
        sources=sorted({r["source_sha256"] for r in rows}),
        points=[StationPoint(t=r["t"], value=r["value"]) for r in rows],
    )
