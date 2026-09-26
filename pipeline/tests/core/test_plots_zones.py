from fastapi.testclient import TestClient

from pipeline.api import create_app
from pipeline.core.plots import store
from pipeline.core.regions import sea_area_of, sea_areas

client = TestClient(create_app())


def test_sea_areas_from_reviewed_polygons():
    areas = sea_areas()
    assert set(areas) == {"karakuwa-east", "kesennuma-bay"}
    k = areas["karakuwa-east"]
    assert (k.name, k.name_ja, k.prefecture) == ("Karakuwa Peninsula East", "唐桑半島東部", "miyagi")


def test_demo_plots_are_inside_their_sea_area():
    plots = store.plots()
    assert sorted(plots) == [f"p1213-{i:03d}" for i in range(1, 16)]
    for p in plots.values():
        assert sea_areas()["karakuwa-east"].geometry.contains(p.geometry)
        assert sea_area_of(p.geometry) == p.sea_area == "karakuwa-east"
        assert 15_000 < p.area_m2 < 25_000
    assert [p.plot_code for p in store.query(species="oyster")] == ["p1213-013", "p1213-014", "p1213-015"]


def test_get_plots_and_zones():
    body = client.get("/plots").json()
    assert len(body) == 15
    first = body[0]
    assert first["plotCode"] == "p1213-001" and first["seaArea"] == "karakuwa-east" and first["source"] == "demo"
    assert set(first) >= {"geometry", "species", "operation", "areaM2", "centroid"}

    assert len(client.get("/plots?bbox=141.67,38.89,141.69,38.91").json()) == 6
    assert client.get("/plots?bbox=130,30,131,31").json() == []
    assert client.get("/plots?species=hoya").json()[0]["plotCode"] == "p1213-009"
    assert client.get("/plots?bbox=1,2,3").status_code == 422

    zones = client.get("/zones").json()
    assert [z["id"] for z in zones] == ["karakuwa-east", "kesennuma-bay"]
    assert zones[0]["geometry"]["type"] == "Polygon" and zones[0]["nameJa"] == "唐桑半島東部"
