"""Hermetic tests: data/ and out/ live in a temp dir (with the reviewed data/ref linked in), and JAXA is faked."""

from pathlib import Path

import pytest
from fakes import FakeJaxa

REPO_DATA = Path(__file__).resolve().parents[1] / "data"


@pytest.fixture(autouse=True)
def isolated_dirs(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    (data / "ref").symlink_to(REPO_DATA / "ref", target_is_directory=True)
    monkeypatch.setenv("PIPELINE_DATA_DIR", str(data))
    monkeypatch.setenv("PIPELINE_OUT_DIR", str(tmp_path / "out"))
    return tmp_path


@pytest.fixture
def jaxa(monkeypatch) -> FakeJaxa:
    fake = FakeJaxa()
    monkeypatch.setattr("pipeline.core.pin._download", fake.download)
    return fake
