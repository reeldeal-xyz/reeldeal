# /// script
# requires-python = ">=3.12"
# dependencies = ["pymupdf>=1.26", "shapely>=2.1"]
# ///
"""Convert the Fisheries Agency's Miyagi 区画漁業権 list (PDF) to GeoJSON.

Source: 水産庁「宮城県宮城海区 区画漁業権に関する情報一覧」
https://www.jfa.maff.go.jp/j/enoki/attach/pdf/gyogyouken_jouhou3-434.pdf
Each right's area is given as vertices (degrees + decimal minutes) joined in a
stated order. Two rights (区第2606号, 区第2612号) are closed by the high-water
shoreline instead of a listed vertex; they are closed with a straight line and
flagged `shoreline_bounded`. Vertices named in the order but not listed are
dropped and reported in `missing_vertices`.

Usage: uv run pipeline/scripts/miyagi_kukaku_to_geojson.py [PDF] [OUT]
"""

import hashlib
import json
import re
import sys
import urllib.request
from datetime import UTC, datetime
from math import cos, radians
from pathlib import Path

import pymupdf
from shapely.geometry import Polygon, mapping
from shapely.validation import explain_validity

SOURCE_URL = "https://www.jfa.maff.go.jp/j/enoki/attach/pdf/gyogyouken_jouhou3-434.pdf"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = ROOT / "data/raw/fishery-rights/jfa-miyagi-kukaku.pdf"
DEFAULT_OUT = ROOT / "data/ref/fishery-rights/miyagi-kukaku-2023.geojson"

ORDER = re.compile(r"次に掲げる点を([ア-ン、]+)の順に結んだ線")
VERTEX = re.compile(r"([ア-ン])北緯(\d+)°([\d.]+)['′]、?東経(\d+)°([\d.]+)['′]")
COLUMNS = ["id", "holder", "location", "area", None, "right_type", "fishery",
           "season", "term", "group_or_individual", "districts", "conditions"]


def clean(s: str | None) -> str:
    return re.sub(r"\s+", "", s or "")


def rows(pdf: Path):
    for page in pymupdf.open(pdf):
        for table in page.find_tables().tables:
            for r in table.extract():
                if r[0] and r[0].startswith("区第"):
                    yield page.number + 1, r


def feature(page: int, r: list[str | None]) -> dict:
    cells = dict(zip(COLUMNS, r))
    area = clean(cells["area"])
    order = ORDER.search(area)
    if not order:
        raise ValueError(f"{cells['id']}: no vertex order in {area[:80]}")
    verts = {m[0]: (int(m[3]) + float(m[4]) / 60, int(m[1]) + float(m[2]) / 60)
             for m in VERTEX.findall(area)}
    seq = order[1].split("、")
    # The source occasionally names a vertex in the order without listing it
    # (e.g. 区第3124号 キ); drop it and flag the feature rather than fail.
    missing = sorted({k for k in seq if k not in verts})
    ring = [(round(x, 7), round(y, 7)) for x, y in (verts[k] for k in seq if k in verts)]
    poly = Polygon(ring)
    return {
        "type": "Feature",
        "id": clean(cells["id"]),
        "properties": {
            "right_no": clean(cells["id"]),
            "holder": clean(cells["holder"]),
            "location": clean(cells["location"]),
            "right_type": clean(cells["right_type"]),
            "fishery": "・".join(filter(None, (cells["fishery"] or "").split("\n"))),
            "season": clean(cells["season"]),
            "term": clean(cells["term"]),
            "districts": clean(cells["districts"]),
            "conditions": clean(cells["conditions"]),
            "n_vertices": len(ring) - 1,
            "missing_vertices": "、".join(missing) or None,
            "shoreline_bounded": "海岸線" in area,
            "valid": poly.is_valid,
            "invalid_reason": None if poly.is_valid else explain_validity(poly),
            "area_ha": None,  # filled in main()
            "source_page": page,
        },
        "geometry": mapping(poly),
    }


def main() -> None:
    pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PDF
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    if not pdf.exists():
        pdf.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0"})
        pdf.write_bytes(urllib.request.urlopen(req).read())
    sha = hashlib.sha256(pdf.read_bytes()).hexdigest()

    feats = [feature(page, r) for page, r in rows(pdf)]
    for f in feats:
        # Local equirectangular approximation; good to <0.1% at plot scale.
        lat0 = radians(f["geometry"]["coordinates"][0][0][1])
        ring = [(x * 111_320 * cos(lat0), y * 110_574) for x, y in f["geometry"]["coordinates"][0]]
        f["properties"]["area_ha"] = round(Polygon(ring).area / 10_000, 2)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "type": "FeatureCollection",
        "name": "miyagi_kukaku_2023",
        "metadata": {
            "source": "水産庁「宮城県宮城海区 区画漁業権に関する情報一覧」",
            "source_url": SOURCE_URL,
            "source_sha256": sha,
            "generated": datetime.now(UTC).isoformat(timespec="seconds"),
            "crs_note": "Coordinates as published (datum unstated; assumed JGD2011 ≈ WGS84).",
        },
        "features": feats,
    }, ensure_ascii=False, indent=1))
    bad = [f["id"] for f in feats if not f["properties"]["valid"]]
    print(f"{len(feats)} features → {out}\ninvalid: {bad or 'none'}")


if __name__ == "__main__":
    main()
