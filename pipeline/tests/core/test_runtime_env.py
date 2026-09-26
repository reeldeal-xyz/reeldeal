import importlib.util
import stat
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pytest

spec = importlib.util.spec_from_file_location("prepare_runtime_env", Path(__file__).resolve().parents[2] / "scripts/prepare_runtime_env.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


def test_configures_only_pipeline_credentials_atomically(tmp_path):
    database = tmp_path / "db.env"
    target = tmp_path / "pipeline.env"
    password = "test$:@ /?#%"
    database.write_text(f"PIPELINE_PASSWORD='{password}'\nPOSTGRES_DB=reeldeal\nPOSTGRES_PASSWORD=not-for-pipeline\n")
    target.write_text("SITE_ADDRESS=example.test\nDATABASE_URL=\nPIPELINE_OUT_DIR=/app/out\n")
    assert runtime.prepare(database, target) is True
    content = target.read_text()
    url = urlsplit(runtime.env_value(content, "DATABASE_URL"))
    assert url.username == "pipeline" and url.hostname == "db"
    assert unquote(url.password) == password
    assert url.path == "/reeldeal"
    assert "not-for-pipeline" not in content
    assert "$" not in runtime.env_value(content, "DATABASE_URL")
    assert "SITE_ADDRESS=example.test" in content
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert runtime.prepare(database, target) is False
    assert target.read_text() == content


def test_existing_database_connection_is_never_overwritten(tmp_path):
    target = tmp_path / "pipeline.env"
    content = "DATABASE_URL=postgresql://pipeline:custom@managed.example/reeldeal\n"
    target.write_text(content)
    assert runtime.prepare(tmp_path / "missing-db.env", target) is False
    assert target.read_text() == content


@pytest.mark.parametrize("db_text", ["", "APP_PASSWORD=no\n", "PIPELINE_PASSWORD=\n", "PIPELINE_PASSWORD='broken\n", "PIPELINE_PASSWORD=a\nPIPELINE_PASSWORD=b\n"])
def test_invalid_credentials_leave_original_untouched(tmp_path, db_text):
    database = tmp_path / "db.env"
    target = tmp_path / "pipeline.env"
    database.write_text(db_text)
    target.write_text("SITE_ADDRESS=example.test\n")
    with pytest.raises(ValueError):
        runtime.prepare(database, target)
    assert target.read_text() == "SITE_ADDRESS=example.test\n"


def test_invalid_existing_url_is_not_replaced(tmp_path):
    database = tmp_path / "db.env"
    target = tmp_path / "pipeline.env"
    database.write_text("PIPELINE_PASSWORD=test\n")
    target.write_text("DATABASE_URL=https://wrong.example\n")
    with pytest.raises(ValueError, match="Invalid existing"):
        runtime.prepare(database, target)
    assert target.read_text() == "DATABASE_URL=https://wrong.example\n"


def test_missing_database_env_has_clear_error_without_creating_target(tmp_path):
    target = tmp_path / "pipeline.env"
    with pytest.raises(ValueError, match="provision the database"):
        runtime.prepare(tmp_path / "missing", target)
    assert not target.exists()
