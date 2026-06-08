"""documents.controller_opened_at — controller buyurtma detalini birinchi ochgan vaqt.

Revision ID: 20260605_0081
Revises: 20260604_0080
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260605_0081"
down_revision = "20260604_0080"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("controller_opened_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("documents", "controller_opened_at")
