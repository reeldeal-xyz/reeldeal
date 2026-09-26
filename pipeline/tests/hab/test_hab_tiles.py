import math
import zlib
from datetime import date

import numpy as np
import pytest
from fakes import SGLI_CHLA
from fastapi.testclient import TestClient

from pipeline.api import create_app
from pipeline.cli import main
from pipeline.core.tiles import EMPTY_PNG, SCALES, normalise

client = TestClient(create_app())


def xyz(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def decode(body: bytes) -> np.ndarray:
    """RGBA pixels of a PNG written by tiles.png (one IDAT, filter 0)."""
    assert body[:8] == b"\x89PNG\r\n\x1a\n"
    w, h = int.from_bytes(body[16:20], "big"), int.from_bytes(body[20:24], "big")
    length = int.from_bytes(body[33:37], "big")
    assert body[37:41] == b"IDAT"
    raw = np.frombuffer(zlib.decompress(body[41 : 41 + length]), dtype=np.uint8).reshape(h, w * 4 + 1)
    assert (raw[:, 0] == 0).all()
    return raw[:, 1:].reshape(h, w, 4)


@pytest.fixture
def chla_month(jaxa):
    jaxa.sgli("sgli_chla_monthly", date(2025, 8, 1), 0.8, scaling=SGLI_CHLA)
    assert main(["hab", "build", "--month", "2025-08"]) == 0
    (info,) = client.get("/hab/layers/2025-08-15").json()
    return info


def test_layers_carry_tile_template_and_scale(chla_month):
    assert chla_month["tileUrl"] == "/hab/tiles/miyagi/monthly/2025-08/chla_sgli_monthly/{z}/{x}/{y}.png"
    assert chla_month["tileScale"]["kind"] == "log"
    assert chla_month["tileScale"]["unit"] == "mg/m3"


def test_tile_over_data_is_coloured(chla_month):
    x, y = xyz(141.7, 38.9, 10)  # inside the fake SGLI patch around Karakuwa
    r = client.get(chla_month["tileUrl"].format(z=10, x=x, y=y))
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.headers["etag"].startswith(f'"{chla_month["sha256"][:32]}')
    rgba = decode(r.content)
    assert rgba.shape == (256, 256, 4)
    opaque = rgba[..., 3] == 255
    assert opaque.any()
    # 0.8 mg/m3 is a single colour; every opaque pixel carries it.
    assert len({tuple(p) for p in rgba[opaque][:, :3]}) == 1


def test_tile_outside_grid_is_transparent(chla_month):
    x, y = xyz(130.0, 33.0, 10)  # Kyushu, far outside the Miyagi grid
    r = client.get(chla_month["tileUrl"].format(z=10, x=x, y=y))
    assert r.status_code == 200
    assert r.content == EMPTY_PNG


def test_missing_layer_is_404():
    r = client.get("/hab/tiles/miyagi/monthly/2020-01/chla_sgli_monthly/10/900/400.png")
    assert r.status_code == 404


@pytest.mark.parametrize(
    "url",
    [
        "/hab/tiles/atlantis/monthly/2025-08/chla_sgli_monthly/10/900/400.png",  # unknown region
        "/hab/tiles/miyagi/monthly/2025-08-01/chla_sgli_monthly/10/900/400.png",  # daily label on a monthly layer
        "/hab/tiles/miyagi/monthly/2025-08/..%2Fsecrets/10/900/400.png",  # not a layer name
        "/hab/tiles/miyagi/monthly/2025-08/chla_sgli_monthly/2/9/0.png",  # x beyond 2**z
        "/hab/tiles/miyagi/monthly/2025-08/chla_sgli_monthly/17/0/0.png",  # beyond MAX_ZOOM
        "/hab/tiles/miyagi/yearly/2025/chla_sgli_monthly/10/900/400.png",  # unknown cadence
    ],
)
def test_bad_tile_paths_are_rejected(url):
    assert client.get(url).status_code in (404, 422)


def test_log_scale_ends_and_clipping():
    chl = SCALES["CHL"]
    v = normalise(np.array([0.01, chl.min, math.sqrt(chl.min * chl.max), chl.max, 1000.0]), chl)
    assert v.tolist() == pytest.approx([0.0, 0.0, 0.5, 1.0, 1.0])
