"""
Audit logging service. Tracks who did what, when.
Never raises - wraps in try/except so main transaction is never affected.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)

ACTION_CREATE = "CREATE"
ACTION_UPDATE = "UPDATE"
ACTION_DELETE = "DELETE"


def get_client_ip(request: "Any") -> str | None:
    """Extract client IP from FastAPI Request."""
    if request is None:
        return None
    forwarded = getattr(request, "headers", None) and request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = getattr(request, "client", None)
    if client:
        return str(client.host) if hasattr(client, "host") else None
    return None


def _serialize(value: Any) -> Any:
    """Convert value to JSON-serializable form."""
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize(v) for v in value]
    return str(value)


def log_action(
    db: Session,
    user_id: uuid.UUID | None,
    action: str,
    entity_type: str,
    entity_id: str,
    old_data: dict | None = None,
    new_data: dict | None = None,
    request_id: str | None = None,
    ip_address: str | None = None,
) -> None:
    """
    Log an audit event. Never raises - errors are logged only.
    """
    try:
        old_serialized = _serialize(old_data) if old_data is not None else None
        new_serialized = _serialize(new_data) if new_data is not None else None

        entry = AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            old_data=old_serialized,
            new_data=new_serialized,
            request_id=request_id,
            ip_address=ip_address,
        )
        db.add(entry)
        db.flush()
    except Exception as exc:
        logger.warning("Audit log failed (non-fatal): %s", exc, exc_info=True)
