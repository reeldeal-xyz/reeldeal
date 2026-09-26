from datetime import date

import pytest
from fakes import SGLI_CHLA
from fastapi.testclient import TestClient

from pipeline.api import create_app
from pipeline.cli import main
from pipeline.core.grid import read_layer
from pipeline.core.layers import layer_path
from pipeline.hazards.hab.sources.jaxa_chla import CHLA_DAILY

client = TestClient(create_app())


def test_chla_daily_and_monthly_layers(jaxa):
    day = date(2025, 8, 1)
    jaxa.sgli("sgli_chla_daily", day, 1.6, scaling=SGLI_CHLA)
    jaxa.sgli("sgli_chla_monthly", day, 0.8, scaling=SGLI_CHLA)
    assert main(["hab", "build", "--start", "2025-08-01", "--end", "2025-08-02"]) == 0

    layer = read_layer(layer_path("hab", "miyagi", CHLA_DAILY, day))
    assert layer.meta["product"] == "GCOM-C_SGLI_L3-CHLA.daytime.v3"
    assert float(layer.data[~(layer.data != layer.data)].max()) == pytest.approx(1.6, abs=0.002)

    body = client.get("/hab/layers/2025-08-01").json()
    assert {(l["layer"], l["cadence"]) for l in body} == {("chla_sgli", "daily"), ("chla_sgli_monthly", "monthly")}
    assert {l["unit"] for l in body} == {"mg/m3"}


def test_month_only_build(jaxa):
    jaxa.sgli("sgli_chla_monthly", date(2025, 7, 1), 0.8, scaling=SGLI_CHLA)
    assert main(["hab", "build", "--month", "2025-07"]) == 0
    assert all("/2025-07/2/" in u for u in jaxa.requests)  # no daily requests
