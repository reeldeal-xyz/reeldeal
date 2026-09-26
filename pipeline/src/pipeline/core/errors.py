"""HTTP error helpers shared by the routers."""

from collections.abc import Callable
from typing import TypeVar

from fastapi import HTTPException, status

F = TypeVar("F", bound=Callable)


def not_implemented(what: str) -> HTTPException:
    """Raised by route stubs whose analysis is not written yet."""
    return HTTPException(status.HTTP_501_NOT_IMPLEMENTED, detail=f"{what} is not implemented yet")


def stub(endpoint: F) -> F:
    """Mark a route whose analysis is not written yet, so /health reports it (remove when implemented)."""
    endpoint.__pipeline_stub__ = True  # type: ignore[attr-defined]
    return endpoint


def is_stub(endpoint: Callable) -> bool:
    return getattr(endpoint, "__pipeline_stub__", False)
