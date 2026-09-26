"""Pin before compute (README §2).

Every downloaded input is stored byte-for-byte under `data/raw/<module>/`, next to a `<file>.pin.json`
sidecar holding its URL, sha256, size and fetch time. The sidecars together are the manifest. Compute only
reads files through `open_pinned`, which re-checks the sha256, so an index value's `source.sha256` always
names the exact bytes it was computed from.
"""

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from pipeline.core.config import raw_dir, user_agent

SIDECAR = ".pin.json"


class PinError(RuntimeError):
    pass


@dataclass(frozen=True)
class Pinned:
    url: str
    path: Path
    sha256: str
    size: int
    fetched_at: str

    def to_json(self) -> dict:
        d = asdict(self)
        d["path"] = str(self.path)
        return d


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def combined_sha256(shas: list[str]) -> str:
    """One digest for a value computed from several pinned inputs: sha256 of the sorted hex digests, newline-joined.

    A single input keeps its own digest, so the common case stays directly checkable against the file.
    """
    unique = sorted(set(shas))
    if len(unique) == 1:
        return unique[0]
    return sha256_bytes("\n".join(unique).encode())


def _sidecar(path: Path) -> Path:
    return path.with_name(path.name + SIDECAR)


def _download(url: str, timeout: float, retries: int) -> bytes | None:
    """GET a URL. Returns None on 404 (the product has no file for that date/tile)."""
    req = urllib.request.Request(url, headers={"User-Agent": user_agent()})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == retries or e.code < 500:
                raise PinError(f"GET {url}: HTTP {e.code}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == retries:
                raise PinError(f"GET {url}: {e}") from e
        time.sleep(2**attempt)
    return None


def read_pin(path: Path) -> Pinned | None:
    side = _sidecar(path)
    if not (path.exists() and side.exists()):
        return None
    meta = json.loads(side.read_text())
    return Pinned(url=meta["url"], path=path, sha256=meta["sha256"], size=meta["size"], fetched_at=meta["fetched_at"])


def pin(
    url: str,
    module: str,
    relpath: str,
    *,
    refresh: bool = False,
    offline: bool = False,
    timeout: float = 60,
    retries: int = 3,
) -> Pinned | None:
    """Download `url` to `data/raw/<module>/<relpath>` once, and record it. Returns None if the source has no such file.

    An existing pin is reused unless `refresh` is set; published inputs are immutable by URL, so a changed file
    at the same URL is a new pin and the old sha256 stops matching. `offline` only returns existing pins.
    """
    path = raw_dir(module) / relpath
    if not refresh and (existing := read_pin(path)):
        return existing
    if offline:
        return None
    data = _download(url, timeout, retries)
    if data is None:
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    pinned = Pinned(
        url=url,
        path=path,
        sha256=sha256_bytes(data),
        size=len(data),
        fetched_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    tmp = path.with_name(f"{path.name}.{os.getpid()}.part")
    tmp.write_bytes(data)
    tmp.replace(path)
    meta = {k: v for k, v in pinned.to_json().items() if k != "path"}
    _sidecar(path).write_text(json.dumps(meta, indent=2) + "\n")
    return pinned


def open_pinned(p: Pinned) -> bytes:
    """Read a pinned file, refusing it if the bytes no longer match the recorded sha256."""
    data = p.path.read_bytes()
    if sha256_bytes(data) != p.sha256:
        raise PinError(f"{p.path}: sha256 mismatch with its pin (expected {p.sha256})")
    return data


def manifest(module: str) -> list[Pinned]:
    """Every pinned input of a module."""
    root = raw_dir(module)
    pins = (read_pin(side.with_name(side.name.removesuffix(SIDECAR))) for side in root.rglob(f"*{SIDECAR}"))
    return sorted((p for p in pins if p), key=lambda p: str(p.path))
