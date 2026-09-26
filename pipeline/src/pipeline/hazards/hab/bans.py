"""Shellfish toxin restrictions (README §7): normalize bulletins, keep the reviewed table, store it in PostGIS.

Flow: a prefecture adapter turns a pinned bulletin transcription into `BanInterval` rows -> the rows are written to
`data/ref/hab/bans.csv`, which only changes through a reviewed commit (the human sign-off) -> `pipeline hab build`
upserts that reviewed table into `risk.restrictions` -> the routes read the database.

Miyagi (the only adapter so far): `data/toxin/scallop-ban-2026.json`, hand-transcribed from the prefecture's PSP
table (令和8年度 宮城県の貝毒による規制・解除状況). Episodes whose start is not in the pinned table are not used.
"""

import csv
import io
import json
from datetime import date
from pathlib import Path

from pipeline.core import db
from pipeline.core.config import data_dir, ref_dir

from .schemas import BanInterval

FIELDS = list(BanInterval.model_fields)

# The transcription's toxin description -> the normalized toxin code.
_TOXINS = {"paralytic": "PSP", "diarrhetic": "DSP"}


def reviewed_path() -> Path:
    return ref_dir() / "hab" / "bans.csv"


def miyagi_transcriptions() -> list[Path]:
    return sorted((data_dir() / "toxin").glob("*-ban-*.json"))


def normalize_miyagi(path: Path) -> list[BanInterval]:
    """One interval per sea area with a published start: level as printed, lift date if published."""
    doc = json.loads(path.read_text())
    toxin = next(code for word, code in _TOXINS.items() if word in doc["toxinType"])
    src = doc["source"]
    return [
        BanInterval(
            pref="miyagi",
            sea_area=zone,
            species=doc["species"],
            toxin=toxin,
            level="出荷自主規制",
            restricted_from=date.fromisoformat(z["banStart"]),
            lifted_on=date.fromisoformat(z["banLift"]) if z.get("banLift") else None,
            source_url=src["url"],
            sha256=src["sha256"],
            confidence="high",
        )
        for zone, z in sorted(doc["zones"].items())
        if z.get("banStart")
    ]


def to_csv(bans: list[BanInterval]) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    for b in sorted(bans, key=lambda b: (b.pref, b.sea_area, b.species, b.toxin, b.restricted_from)):
        writer.writerow({k: "" if v is None else v for k, v in b.model_dump(mode="json", by_alias=False).items()})
    return out.getvalue()


def read_reviewed(path: Path | None = None) -> list[BanInterval]:
    rows = csv.DictReader(io.StringIO((path or reviewed_path()).read_text()))
    return [BanInterval.model_validate({k: (v or None) for k, v in row.items()}) for row in rows]


def import_reviewed(conn, bans: list[BanInterval]) -> int:
    """Upsert the reviewed intervals into risk.restrictions (keyed by sea area, species, toxin and start)."""
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO risk.restrictions
              (sea_area_id, species, toxin, starts_on, ends_on, bulletin_url, source_sha256, pref, level, confidence)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (sea_area_id, species, toxin, starts_on) DO UPDATE SET
              ends_on = EXCLUDED.ends_on, bulletin_url = EXCLUDED.bulletin_url,
              source_sha256 = EXCLUDED.source_sha256, pref = EXCLUDED.pref, level = EXCLUDED.level,
              confidence = EXCLUDED.confidence
            """,
            [
                (
                    b.sea_area,
                    b.species,
                    b.toxin,
                    b.restricted_from,
                    b.lifted_on,
                    b.source_url,
                    b.sha256,
                    b.pref,
                    b.level,
                    b.confidence,
                )
                for b in bans
            ],
        )
    return len(bans)


def build() -> dict:
    """`pipeline hab build`: publish the reviewed table to the database (skipped while DATABASE_URL is unset)."""
    bans = read_reviewed()
    if not db.configured():
        return {"bans": {"reviewed": len(bans), "skipped": "DATABASE_URL is not set"}}
    with db.connect() as conn:
        return {"bans": {"reviewed": len(bans), "upserted": import_reviewed(conn, bans)}}


_SELECT = """
    SELECT pref, sea_area_id AS sea_area, species, toxin, level, starts_on AS restricted_from,
           ends_on AS lifted_on, bulletin_url AS source_url, source_sha256 AS sha256, confidence
    FROM risk.restrictions
"""


def _rows(sql: str, params: tuple) -> list[BanInterval]:
    with db.connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [BanInterval.model_validate(r) for r in rows]


def bans(start: date, end: date, pref: str | None = None) -> list[BanInterval]:
    """Intervals in force at any time in [start, end]."""
    return _rows(
        _SELECT + " WHERE starts_on <= %s AND (ends_on IS NULL OR ends_on >= %s) AND (%s::text IS NULL OR pref = %s)"
        " ORDER BY pref, sea_area_id, species, toxin, starts_on",
        (end, start, pref, pref),
    )


def zone_bans(zone: str, start: date, end: date, species: str | None = None) -> list[BanInterval]:
    return _rows(
        _SELECT + " WHERE sea_area_id = %s AND starts_on <= %s AND (ends_on IS NULL OR ends_on >= %s)"
        " AND (%s::text IS NULL OR species = %s) ORDER BY species, toxin, starts_on",
        (zone, end, start, species, species),
    )
