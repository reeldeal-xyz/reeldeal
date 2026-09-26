from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from pipeline.api import create_app
from pipeline.core import db
from pipeline.core.plots import inventory, store

client = TestClient(create_app())


def test_database_outage_does_not_resurrect_synthetic_geometry(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://pipeline:test@db/reeldeal")

    def unavailable(*args):
        raise db.NoDatabase("connection failed")

    monkeypatch.setattr(inventory, "query", unavailable)
    monkeypatch.setattr(inventory, "get", unavailable)
    with pytest.raises(db.NoDatabase):
        store.query_all()
    with pytest.raises(db.NoDatabase):
        store.lookup("p1213-001")
    response = client.get("/plots")
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}


def test_reachable_database_missing_or_retired_plot_does_not_fall_back(monkeypatch):
    monkeypatch.setattr(inventory, "get", lambda code: None)
    monkeypatch.setattr(inventory, "query", lambda *args: [])
    assert store.get("p1213-001") is not None
    assert store.lookup("p1213-001") is None
    assert store.query_all() == []


def test_db_less_local_development_retains_explicit_seed(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert store.lookup("p1213-001").source == "demo"
    assert all(plot.source == "demo" for plot in store.query_all())


def test_readiness_does_not_expose_connection_details(monkeypatch):
    @contextmanager
    def unavailable():
        raise db.NoDatabase("postgresql://pipeline:secret@private-host/db")
        yield

    monkeypatch.setattr(db, "connect", unavailable)
    response = client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "not-ready", "database": "unavailable"}
    assert "secret" not in response.text
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize("count,status", [(0, 503), (15, 200), (467, 200)])
def test_readiness_requires_accessible_nonempty_inventory(monkeypatch, count, status):
    @contextmanager
    def connection():
        yield SimpleNamespace(execute=lambda sql: SimpleNamespace(fetchone=lambda: {"plots": count}))

    monkeypatch.setattr(db, "connect", connection)
    response = client.get("/ready")
    assert response.status_code == status
    assert response.json()["plotCount"] == count
