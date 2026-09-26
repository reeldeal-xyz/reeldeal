"""Paths and environment (README §9, §12).

`PIPELINE_ROOT` defaults to the `pipeline/` directory in a source checkout, and to the working directory
otherwise (the Docker image runs from /app with `data/` and `out/` mounted as volumes).
"""

import os
from pathlib import Path

_SOURCE_ROOT = Path(__file__).resolve().parents[3]


def root() -> Path:
    if env := os.environ.get("PIPELINE_ROOT"):
        return Path(env)
    if (_SOURCE_ROOT / "pyproject.toml").exists():
        return _SOURCE_ROOT
    return Path.cwd()


def data_dir() -> Path:
    return Path(os.environ.get("PIPELINE_DATA_DIR") or root() / "data")


def raw_dir(module: str) -> Path:
    """Pinned inputs, byte-for-byte (§2 "pin before compute")."""
    return data_dir() / "raw" / module


def ref_dir() -> Path:
    """Small reviewed lookup tables: plots, sea areas."""
    return data_dir() / "ref"


def out_dir(module: str) -> Path:
    return Path(os.environ.get("PIPELINE_OUT_DIR") or root() / "out") / module


def user_agent() -> str:
    from pipeline import __version__

    return f"reeldeal-pipeline/{__version__} (+https://github.com/reeldeal-xyz/reeldeal)"
