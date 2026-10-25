class ApiError(Exception):
    """Domain error that the API layer maps to an HTTP response."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class NotFound(ApiError):
    def __init__(self, what: str) -> None:
        super().__init__(404, f"{what} not found")


class Conflict(ApiError):
    def __init__(self, detail: str) -> None:
        super().__init__(409, detail)


class BadRequest(ApiError):
    def __init__(self, detail: str) -> None:
        super().__init__(422, detail)


class InsufficientStock(ApiError):
    def __init__(self, item_sku: str, warehouse_code: str, available: int, requested: int) -> None:
        super().__init__(
            409,
            f"Not enough stock of {item_sku} in {warehouse_code}: "
            f"{available} on hand, {requested} requested.",
        )
