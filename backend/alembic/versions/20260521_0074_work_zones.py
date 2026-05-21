"""Add work_zones table for SmartUp room_id import exclusions.

Revision ID: 20260521_0074
Revises: 20260513_0073
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260521_0074"
down_revision = "20260513_0073"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "work_zones",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("room_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("room_id", name="uq_work_zones_room_id"),
    )
    op.create_index("ix_work_zones_room_id", "work_zones", ["room_id"])


def downgrade():
    op.drop_index("ix_work_zones_room_id", table_name="work_zones")
    op.drop_table("work_zones")
