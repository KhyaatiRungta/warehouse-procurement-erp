import os


def _bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg://localhost:5432/warehouse_erp"
)
JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me-please-32-bytes-min")
JWT_ALGORITHM = "HS256"
JWT_TTL_MINUTES = int(os.getenv("JWT_TTL_MINUTES", "480"))
SEED_DEMO = _bool(os.getenv("SEED_DEMO"), True)
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5200,http://127.0.0.1:5200"
    ).split(",")
    if origin.strip()
]
