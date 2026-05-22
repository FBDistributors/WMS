"""Add settings_organizations reference table.

Revision ID: 20260521_0075
Revises: 20260521_0074
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260521_0075"
down_revision = "20260521_0074"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "settings_organizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", name="uq_settings_organizations_org_id"),
    )
    op.create_index("ix_settings_organizations_org_id", "settings_organizations", ["org_id"])


def downgrade():
    op.drop_index("ix_settings_organizations_org_id", table_name="settings_organizations")
    op.drop_table("settings_organizations")
