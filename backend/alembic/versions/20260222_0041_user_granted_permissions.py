"""Add granted_permissions to users (per-user extra permissions).

Revision ID: 20260222_0041
Revises: 20260222_0040
Create Date: 2026-02-22

Admin can grant extra permissions to a user (e.g. picker + receiving:write).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260222_0041"
down_revision = "20260222_0040"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column("granted_permissions", JSONB, nullable=True),
    )


def downgrade():
    op.drop_column("users", "granted_permissions")
