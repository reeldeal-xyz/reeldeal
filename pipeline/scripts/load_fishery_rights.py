# /// script
# requires-python = ">=3.12"
# dependencies = ["psycopg[binary]>=3.2"]
# ///
"""Upsert a fishery-right GeoJSON (from miyagi_kukaku_to_geojson.py) into geo.plots.

Runs as the `pipeline` role. Rows are keyed by plot_code '<pref>-ku-<licence no.>'; re-running
updates geometry in place (the archive trigger keeps the old shape in geo.plots_history).
sea_area_id is set when the plot's point-on-surface lies in a known sea area.

Usage: DATABASE_URL=postgres://pipeline:…@host:5432/reeldeal \
       uv run pipeline/scripts/load_fishery_rights.py [GEOJSON] [--pref 04]
"""

import argparse
import json
import os
import re
from pathlib import Path

import psycopg

DEFAULT = Path(__file__).resolve().parents[1] / "data/ref/fishery-rights/miyagi-kukaku-2023.geojson"

# 漁業の名称 → geo.plots.operation. Hanging culture (shellfish and seaweed) in Miyagi is longline.
OPERATION = {"小割式魚類養殖業": "cage", "貝類等垂下式養殖業": "longline", "藻類養殖業": "longline"}

UPSERT = """
INSERT INTO geo.plots (plot_code, origin, geom, operation, sea_area_id, source_url, source_sha256,
                       valid_from, valid_to)
SELECT %(code)s, 'fishery_right', g, %(operation)s,
       (SELECT id FROM geo.sea_areas s WHERE ST_Contains(s.geom, ST_PointOnSurface(g)) ORDER BY id LIMIT 1),
       %(url)s, %(sha)s, %(valid_from)s, %(valid_to)s
FROM ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326)) AS g
ON CONFLICT (plot_code) DO UPDATE SET
  geom = EXCLUDED.geom, operation = EXCLUDED.operation, sea_area_id = EXCLUDED.sea_area_id,
  source_url = EXCLUDED.source_url, source_sha256 = EXCLUDED.source_sha256, valid_to = EXCLUDED.valid_to
WHERE geo.plots.origin = 'fishery_right'
RETURNING (xmax = 0) AS inserted
"""


def wareki_term(term: str) -> tuple[str, str]:
    """'令和5年9月1日から令和10年8月31日まで' → ('2023-09-01', '2028-08-31')."""
    dates = re.findall(r"令和(\d+)年(\d+)月(\d+)日", term)
    if len(dates) != 2:
        raise ValueError(f"unparsed licence term {term!r}")
    return tuple(f"{2018 + int(y)}-{int(m):02d}-{int(d):02d}" for y, m, d in dates)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("geojson", nargs="?", type=Path, default=DEFAULT)
    ap.add_argument("--pref", default="04", help="JIS prefecture code (Miyagi = 04)")
    args = ap.parse_args()

    fc = json.loads(args.geojson.read_text())
    meta = fc["metadata"]
    inserted = updated = skipped = 0
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        for f in fc["features"]:
            p = f["properties"]
            kinds = {OPERATION.get(k) for k in p["fishery"].split("・")}
            valid_from, valid_to = wareki_term(p["term"])
            cur.execute(UPSERT, {
                "code": f"{args.pref}-ku-{re.search(r'\d+', p['right_no'])[0]}",
                "operation": kinds.pop() if len(kinds) == 1 else "other",
                "url": meta["source_url"],
                "sha": meta["source_sha256"],
                "valid_from": valid_from,
                "valid_to": valid_to,
                "geom": json.dumps(f["geometry"]),
            })
            row = cur.fetchone()
            if row is None:
                skipped += 1  # code exists with another origin; never overwrite it
            elif row[0]:
                inserted += 1
            else:
                updated += 1
    print(f"inserted {inserted}, updated {updated}, skipped {skipped} (other origin)")


if __name__ == "__main__":
    main()
