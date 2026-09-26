"""API surface tests: every route in README §6–§8 and §11 exists, validates input and answers."""

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from pipeline.api import create_app
from pipeline.core.errors import is_stub

client = TestClient(create_app())

KESENNUMA_PLOT = {
    "type": "Feature",
    "properties": {},
    "geometry": {
        "type": "Polygon",
        "coordinates": [[[141.659, 38.849], [141.661, 38.849], [141.661, 38.851], [141.659, 38.851], [141.659, 38.849]]],
    },
}
WINDOW = {"start": "2025-07-01", "end": "2025-09-30"}

# (method, path as in the README, concrete URL, body)
ROUTES = [
    ("GET", "/plots", "/plots", None),
    ("POST", "/plots", "/plots", {"plotCode": "K-1", "geometry": KESENNUMA_PLOT["geometry"], "species": ["scallop"], "operation": "longline"}),
    ("GET", "/stations", "/stations", None),
    ("GET", "/stations/{station_id}/series", "/stations/jma-ayukawa/series?var=sea_level", None),
    ("GET", "/zones", "/zones", None),
    ("POST", "/risk", "/risk", {"feature": KESENNUMA_PLOT, **WINDOW, "species": "scallop", "gear": "longline"}),
    ("POST", "/heat/risk", "/heat/risk", {"feature": KESENNUMA_PLOT, **WINDOW, "t": 25}),
    ("GET", "/heat/plots/{plot}/risk", "/heat/plots/K-1/risk?season=2025", None),
    ("GET", "/heat/indices/{zone}/{season}", "/heat/indices/miyagi-kesennuma/2025", None),
    ("GET", "/heat/forecast/{plot}", "/heat/forecast/K-1", None),
    ("GET", "/heat/layers/{day}", "/heat/layers/2025-09-30", None),
    ("GET", "/heat/climatology/{zone}", "/heat/climatology/miyagi-kesennuma", None),
    ("GET", "/heat/tiles/{region}/{cadence}/{period}/{layer}/{z}/{x}/{y}.png", "/heat/tiles/miyagi/daily/2025-08-15/sst_sgli_night/9/457/196.png", None),
    ("POST", "/hab/risk", "/hab/risk", {"feature": KESENNUMA_PLOT, **WINDOW, "species": "scallop"}),
    ("GET", "/hab/plots/{plot}/risk", "/hab/plots/K-1/risk?season=2025", None),
    ("GET", "/hab/indices/{zone}/{season}", "/hab/indices/miyagi-kesennuma/2025", None),
    ("GET", "/hab/bans", "/hab/bans?pref=miyagi&season=2025", None),
    ("GET", "/hab/redtides", "/hab/redtides?pref=miyagi&season=2025", None),
    ("GET", "/hab/forecast/{zone}", "/hab/forecast/miyagi-kesennuma", None),
    ("GET", "/hab/layers/{day}", "/hab/layers/2025-09-30", None),
    ("GET", "/hab/tiles/{region}/{cadence}/{period}/{layer}/{z}/{x}/{y}.png", "/hab/tiles/miyagi/monthly/2025-08/chla_sgli_monthly/9/457/196.png", None),
    ("POST", "/storm/risk", "/storm/risk", {"feature": KESENNUMA_PLOT, **WINDOW, "gear": "longline", "h": 3}),
    ("GET", "/storm/plots/{plot}/risk", "/storm/plots/K-1/risk?season=2025", None),
    ("GET", "/storm/events", "/storm/events?season=2025", None),
    ("GET", "/storm/events/{event}/impact", "/storm/events/tc-2519/impact", None),
    ("GET", "/storm/indices/{zone}/{season}", "/storm/indices/miyagi-kesennuma/2025", None),
    ("GET", "/storm/forecast/{plot}", "/storm/forecast/K-1", None),
    ("GET", "/storm/layers/{day}", "/storm/layers/2025-09-30", None),
]


def _endpoint(app, method, path):
    for r in (r for router in app.state.routers for r in router.routes):
        if isinstance(r, APIRoute) and r.path == path and method in r.methods:
            return r.endpoint
    raise AssertionError(f"{method} {path} not mounted")


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["modules"]["heat"]["module_version"] == "heat-0.1.0"
    assert set(body["modules"]) == {"heat", "hab", "storm"}
    assert body["commit"] is None


def test_health_reports_stubs_honestly():
    """While routes return 501, /health must not say ok (#35)."""
    body = client.get("/health").json()
    stubs = sum(is_stub(_endpoint(client.app, m, p)) for m, p, _, _ in ROUTES)
    assert body["routes"] == {"implemented": len(ROUTES) - stubs, "total": len(ROUTES)}
    for name, module in body["modules"].items():
        counts = module["routes"]
        expected = "ok" if counts["implemented"] == counts["total"] else "unimplemented" if counts["implemented"] == 0 else "degraded"
        assert module["status"] == expected, name
    if stubs:
        assert body["status"] != "ok"


def test_health_commit_from_env(monkeypatch):
    monkeypatch.setenv("GIT_SHA", "abc1234")
    assert client.get("/health").json()["commit"] == "abc1234"


def test_openapi_lists_every_route():
    paths = client.get("/openapi.json").json()["paths"]
    for method, path, _, _ in ROUTES:
        assert method.lower() in paths.get(path, {}), f"{method} {path} missing from OpenAPI"


@pytest.mark.parametrize(("method", "path", "url", "body"), ROUTES, ids=[f"{m} {p}" for m, p, _, _ in ROUTES])
def test_routes_accept_valid_input_and_501_only_when_stubbed(method, path, url, body):
    """Valid input is never rejected, and a route answers 501 exactly when it is marked @stub (so /health stays true)."""
    r = client.request(method, url, json=body)
    assert r.status_code != 422, r.text
    assert (r.status_code == 501) == is_stub(_endpoint(client.app, method, path)), r.text


@pytest.mark.parametrize(
    ("url", "body"),
    [
        ("/heat/risk", {"feature": KESENNUMA_PLOT}),  # no window
        ("/hab/risk", {"feature": KESENNUMA_PLOT, **WINDOW}),  # no species
        ("/hab/risk", {"feature": KESENNUMA_PLOT, **WINDOW, "species": "tuna?"}),
        ("/storm/risk", {"feature": KESENNUMA_PLOT, **WINDOW, "gear": "net"}),
        ("/heat/risk", {"feature": {"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": [141.66, 38.85]}}, **WINDOW}),
    ],
)
def test_risk_rejects_invalid_input(url, body):
    assert client.post(url, json=body).status_code == 422


def test_single_module_app():
    app = TestClient(create_app(["storm"]))
    assert set(app.get("/health").json()["modules"]) == {"storm"}
    paths = app.get("/openapi.json").json()["paths"]
    assert "/storm/risk" in paths
    assert "/heat/risk" not in paths
    assert "/risk" not in paths
