"""HTTP error helpers shared by the routers."""

from fastapi import HTTPException, status


def not_implemented(what: str) -> HTTPException:
    """Raised by route stubs whose analysis is not written yet."""
    return HTTPException(status.HTTP_501_NOT_IMPLEMENTED, detail=f"{what} is not implemented yet")
