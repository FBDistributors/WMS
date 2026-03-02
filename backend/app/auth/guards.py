"""
Domain-specific RBAC guards: inventory adjust reason_code, move_zone target.
"""
from __future__ import annotations

from fastapi import HTTPException, status

from app.models.user import User

# Controller may use only these reason_codes for inventory adjust (shortage/overage)
CONTROLLER_ADJUST_REASON_WHITELIST = frozenset({"inventory_shortage", "inventory_overage"})

# Picker may move only to these zone types (expired/damaged)
PICKER_MOVE_ZONE_ALLOWED = frozenset({"EXPIRED", "DAMAGED"})

# Optional: max qty per move for picker (None = no limit)
PICKER_MOVE_ZONE_MAX_QTY: int | None = 20


def check_controller_adjust_reason(user: User, reason_code: str | None) -> None:
    """
    CONTROLLER may only use whitelisted reason_codes for adjust.
    ADMIN may use any reason (or none).
    Call after require_permission("inventory:adjust") so only controller/admin reach here.
    """
    if user.role != "inventory_controller":
        return
    if not reason_code or reason_code.strip() not in CONTROLLER_ADJUST_REASON_WHITELIST:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Controller may only use reason_code: {sorted(CONTROLLER_ADJUST_REASON_WHITELIST)}",
        )


def check_picker_move_zone_target(user: User, target_zone_type: str, qty: int | None = None) -> None:
    """
    PICKER may only move to EXPIRED or DAMAGED zones.
    CONTROLLER/ADMIN may move to any zone.
    """
    if user.role != "picker":
        return
    if target_zone_type not in PICKER_MOVE_ZONE_ALLOWED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Picker may only move to zones: {sorted(PICKER_MOVE_ZONE_ALLOWED)}",
        )
    if PICKER_MOVE_ZONE_MAX_QTY is not None and qty is not None and qty > PICKER_MOVE_ZONE_MAX_QTY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Picker move qty must be <= {PICKER_MOVE_ZONE_MAX_QTY}",
        )
