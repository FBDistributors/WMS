"""Add customer_id and customer_name to customer_returns.

Revision ID: 20260421_0064
Revises: 20260414_0063
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260421_0064"
down_revision = "20260414_0063"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "customer_returns",
        sa.Column("customer_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "customer_returns",
        sa.Column("customer_name", sa.String(length=255), nullable=True),
    )
    op.create_index("ix_customer_returns_customer_id", "customer_returns", ["customer_id"])


def downgrade():
    op.drop_index("ix_customer_returns_customer_id", table_name="customer_returns")
    op.drop_column("customer_returns", "customer_name")
    op.drop_column("customer_returns", "customer_id")
