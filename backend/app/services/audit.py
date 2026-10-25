import json
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, User


def _jsonable(value: Any) -> Any:
    if value is None:
        return None
    return json.loads(json.dumps(value, default=str))


def record(
    db: Session,
    actor: User | None,
    *,
    action: str,
    entity_type: str,
    entity_id: int | str,
    summary: str,
    before: dict | None = None,
    after: dict | None = None,
) -> AuditLog:
    """Stage an audit row in the caller's transaction. The caller commits."""
    entry = AuditLog(
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else "system",
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        summary=summary[:255],
        before=_jsonable(before),
        after=_jsonable(after),
    )
    db.add(entry)
    return entry
