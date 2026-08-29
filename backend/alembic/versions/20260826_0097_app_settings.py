"""app_settings: umumiy kalit-qiymat sozlamalari (birinchi: sale_expiry_cutoff).

Revision ID: 20260826_0097
Revises: 20260826_0096
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260826_0097"
down_revision = "20260826_0096"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=64), primary_key=True),
        sa.Column("value", sa.String(length=512), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_by_user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
