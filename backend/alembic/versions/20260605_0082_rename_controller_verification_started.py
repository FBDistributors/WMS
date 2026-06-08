"""Rename controller_opened_at -> controller_verification_started_at.

Revision ID: 20260605_0082
Revises: 20260605_0081
"""
from __future__ import annotations

from alembic import op

revision = "20260605_0082"
down_revision = "20260605_0081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "documents",
        "controller_opened_at",
        new_column_name="controller_verification_started_at",
    )


def downgrade() -> None:
    op.alter_column(
        "documents",
        "controller_verification_started_at",
        new_column_name="controller_opened_at",
    )
