"""Add general_customers table.

Revision ID: 20260421_0065
Revises: 20260421_0064
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260421_0065"
down_revision = "20260421_0064"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "general_customers",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", sa.String(length=64), nullable=False),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("customer_id", name="uq_general_customers_customer_id"),
    )
    op.create_index("ix_general_customers_customer_id", "general_customers", ["customer_id"])


def downgrade():
    op.drop_index("ix_general_customers_customer_id", table_name="general_customers")
    op.drop_table("general_customers")
