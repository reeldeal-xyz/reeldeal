import json

import pytest

from pipeline.core.pin import (
    PinError,
    combined_sha256,
    manifest,
    open_pinned,
    pin,
    sha256_bytes,
)

URL = "https://example.test/a/file.bin"


def test_pin_stores_bytes_and_sidecar_once(jaxa):
    jaxa.files[URL] = b"hello"
    p = pin(URL, "heat", "x/file.bin")
    assert p.path.read_bytes() == b"hello"
    assert p.sha256 == sha256_bytes(b"hello") and p.size == 5
    side = json.loads(p.path.with_name("file.bin.pin.json").read_text())
    assert side["url"] == URL and side["sha256"] == p.sha256 and side["fetched_at"].endswith("Z")

    again = pin(URL, "heat", "x/file.bin")
    assert again == p
    assert jaxa.requests == [URL]  # reused, not re-downloaded
    assert [m.url for m in manifest("heat")] == [URL]


def test_pin_missing_and_offline(jaxa):
    assert pin(URL, "heat", "missing.bin") is None
    jaxa.files[URL] = b"x"
    assert pin(URL, "heat", "later.bin", offline=True) is None
    assert jaxa.requests == [URL]


def test_open_pinned_rejects_changed_bytes(jaxa):
    jaxa.files[URL] = b"original"
    p = pin(URL, "heat", "f.bin")
    assert open_pinned(p) == b"original"
    p.path.write_bytes(b"tampered")
    with pytest.raises(PinError, match="sha256 mismatch"):
        open_pinned(p)


def test_combined_sha256():
    a, b = sha256_bytes(b"a"), sha256_bytes(b"b")
    assert combined_sha256([a]) == a
    assert combined_sha256([a, a]) == a
    assert combined_sha256([a, b]) == combined_sha256([b, a]) != a
