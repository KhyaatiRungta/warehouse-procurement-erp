import datetime as dt

import bcrypt
import jwt

from app.config import JWT_ALGORITHM, JWT_SECRET, JWT_TTL_MINUTES
from app.models import Role

ALL_PERMISSIONS = frozenset(
    {
        "suppliers:write",
        "items:write",
        "warehouses:write",
        "inventory:write",
        "requisitions:write",
        "requisitions:decide",
        "purchase_orders:write",
        "purchase_orders:approve",
        "receipts:write",
        "audit:read",
    }
)

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    Role.ADMIN.value: ALL_PERMISSIONS,
    Role.BUYER.value: frozenset(
        {
            "suppliers:write",
            "items:write",
            "requisitions:write",
            "requisitions:decide",
            "purchase_orders:write",
            "audit:read",
        }
    ),
    Role.CLERK.value: frozenset(
        {
            "inventory:write",
            "requisitions:write",
            "receipts:write",
        }
    ),
}


def permissions_for(role: str) -> list[str]:
    return sorted(ROLE_PERMISSIONS.get(role, frozenset()))


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: int, role: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + dt.timedelta(minutes=JWT_TTL_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
