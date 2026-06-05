from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

OrderStatus = Literal[
    "imported",
    "W",
    "S",
    "allocated",
    "picking",
    "picked",
    "completed",
    "packed",
    "shipped",
    "cancelling_in_progress",
    "cancelled",
]
ReserveAction = Literal["allocate", "unallocate", "noop"]


@dataclass(frozen=True)
class TransitionRule:
    from_status: OrderStatus
    to_status: OrderStatus
    reserve_action: ReserveAction


_RULES: tuple[TransitionRule, ...] = (
    TransitionRule("imported", "allocated", "allocate"),
    TransitionRule("W", "allocated", "allocate"),
    TransitionRule("S", "allocated", "allocate"),
    TransitionRule("allocated", "allocated", "allocate"),
    TransitionRule("allocated", "picking", "noop"),
    TransitionRule("picking", "picked", "noop"),
    TransitionRule("picked", "completed", "noop"),
    TransitionRule("picked", "packed", "noop"),
    TransitionRule("completed", "packed", "noop"),
    TransitionRule("packed", "shipped", "noop"),
    TransitionRule("allocated", "cancelled", "unallocate"),
    TransitionRule("picking", "cancelling_in_progress", "noop"),
    TransitionRule("picking", "cancelled", "unallocate"),
    TransitionRule("cancelling_in_progress", "cancelled", "unallocate"),
)

_RULE_MAP: dict[tuple[str, str], TransitionRule] = {
    (rule.from_status, rule.to_status): rule for rule in _RULES
}


def get_transition_rule(from_status: str, to_status: str) -> TransitionRule | None:
    return _RULE_MAP.get(((from_status or "").strip(), (to_status or "").strip()))


def require_transition_rule(from_status: str, to_status: str) -> TransitionRule:
    rule = get_transition_rule(from_status, to_status)
    if rule is None:
        raise ValueError(f"Transition is not allowed in core flow: {from_status} -> {to_status}")
    return rule

