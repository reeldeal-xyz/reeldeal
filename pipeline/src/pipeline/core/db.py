"""PostGIS access (db/README.md): the database stores, the pipeline computes and writes rows.

`DATABASE_URL` connects as the `pipeline` role (SELECT/INSERT/UPDATE on geo and risk, no DELETE, no DDL). Routes that
need the database answer 503 while it is unset or unreachable; the file-backed routes keep working.
"""

import os
from collections.abc import Iterator
from contextlib import contextmanager
from functools import cache

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout


class NoDatabase(RuntimeError):
    """DATABASE_URL is unset or the database can't be reached."""


def configured() -> bool:
    return bool(os.environ.get("DATABASE_URL"))


@cache
def _pool(url: str) -> ConnectionPool:
    return ConnectionPool(
        url,
        min_size=0,
        max_size=4,
        kwargs={"row_factory": dict_row, "connect_timeout": 5},
        open=True,
    )


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """A pooled connection; commits when the block exits cleanly, rolls back otherwise."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise NoDatabase("DATABASE_URL is not set")
    try:
        with _pool(url).connection(timeout=5) as conn:
            yield conn
    except (PoolTimeout, psycopg.OperationalError) as e:
        raise NoDatabase(f"database unavailable: {e}") from None
