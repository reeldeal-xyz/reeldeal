import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Point

from pipeline.api import create_app
from pipeline.core.plots import inventory, store


@pytest.mark.parametrize("operation", [None, "bottom"])
def test_plot_response_preserves_database_metadata(monkeypatch, operation):
    record = inventory._record({
        "plot_code": "04-ku-1213", "origin": "fishery_right",
        "geojson": {"type": "Polygon", "coordinates": [[
            [141.60, 38.80], [141.66, 38.80], [141.66, 38.86], [141.64, 38.86],
            [141.64, 38.82], [141.62, 38.82], [141.62, 38.86], [141.60, 38.86], [141.60, 38.80],
        ]]},
        "species": ["scallop"], "operation": operation, "sea_area_id": "kesennuma-bay",
        "prefecture": "Miyagi", "area_m2": 12345.67, "lon": 141.61, "lat": 38.84,
    })
    assert not record.geometry.contains(record.geometry.centroid)
    assert record.geometry.contains(Point(record.centroid))
    monkeypatch.setattr(store, "query_all", lambda *args: [record])
    response = TestClient(create_app()).get("/plots")
    assert response.status_code == 200
    plot = response.json()[0]
    assert plot["centroid"] == [141.61, 38.84]
    assert plot["areaM2"] == 12345.67
    assert plot["prefecture"] == "Miyagi"
    assert plot["operation"] == operation
