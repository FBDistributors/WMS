from __future__ import annotations

import os
import re

from app.auth.security import get_password_hash
from app.db import SessionLocal
from app.models.user import User

ROLE_SPECS = [
    {
        "role": "warehouse_admin",
        "username_env": "SEED_WA_USERNAME",
        "password_env": "SEED_WA_PASSWORD",
    },
    {
        "role": "supervisor",
        "username_env": "SEED_SUP_USERNAME",
        "password_env": "SEED_SUP_PASSWORD",
    },
    {
        "role": "picker",
        "username_env": "SEED_PICK_USERNAME",
        "password_env": "SEED_PICK_PASSWORD",
    },
    {
        "role": "receiver",
        "username_env": "SEED_REC_USERNAME",
        "password_env": "SEED_REC_PASSWORD",
    },
    {
        "role": "inventory_controller",
        "username_env": "SEED_INV_USERNAME",
        "password_env": "SEED_INV_PASSWORD",
    },
]

LEGACY_ROLE_MAP = {
    "admin": "warehouse_admin",
    "manager": "supervisor",
}


def _validate_password(password: str) -> None:
    if len(password) < 12:
        raise ValueError("Seed password must be at least 12 characters.")
    if not re.search(r"[A-Z]", password):
        raise ValueError("Seed password must include an uppercase letter.")
    if not re.search(r"[a-z]", password):
        raise ValueError("Seed password must include a lowercase letter.")
    if not re.search(r"[0-9]", password):
        raise ValueError("Seed password must include a digit.")
    if not re.search(r"[^A-Za-z0-9]", password):
        raise ValueError("Seed password must include a symbol.")


def _normalize_role(role: str) -> str:
    return LEGACY_ROLE_MAP.get(role, role)


def seed_users() -> None:
    db = SessionLocal()
    try:
        for spec in ROLE_SPECS:
            role = spec["role"]
            username = os.getenv(spec["username_env"])
            password = os.getenv(spec["password_env"])
            if not username or not password:
                print(f"[seed-users] Skipping {role}: missing credentials")
                continue

            _validate_password(password)
            existing = db.query(User).filter(User.username == username).one_or_none()
            if existing:
                normalized_role = _normalize_role(existing.role)
                if normalized_role != role:
                    existing.role = role
                    db.commit()
                    print(f"[seed-users] Updated role for {username} -> {role}")
                else:
                    print(f"[seed-users] User exists: {username} ({role})")
                continue

            user = User(
                username=username,
                password_hash=get_password_hash(password),
                role=role,
                is_active=True,
            )
            db.add(user)
            db.commit()
            print(f"[seed-users] Created {username} ({role})")
    finally:
        db.close()


def main() -> None:
    seed_users()


if __name__ == "__main__":
    main()
