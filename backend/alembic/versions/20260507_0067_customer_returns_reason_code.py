"""Add reason_code to customer_returns.

Revision ID: 20260507_0067
Revises: 20260421_0066
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260507_0067"
down_revision = "20260421_0066"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "customer_returns",
        sa.Column("reason_code", sa.String(length=32), nullable=True),
    )


def downgrade():
    op.drop_column("customer_returns", "reason_code")
