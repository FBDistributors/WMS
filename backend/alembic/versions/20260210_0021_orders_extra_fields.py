"""Add extra order fields.

Revision ID: 20260210_0021
Revises: 20260210_0020
Create Date: 2026-02-10 12:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260210_0021"
down_revision = "20260210_0020"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("orders", sa.Column("customer_id", sa.String(length=64), nullable=True))
    op.add_column("orders", sa.Column("agent_id", sa.String(length=64), nullable=True))
    op.add_column("orders", sa.Column("agent_name", sa.String(length=255), nullable=True))
    op.add_column("orders", sa.Column("total_amount", sa.Numeric(18, 2), nullable=True))


def downgrade():
    op.drop_column("orders", "total_amount")
    op.drop_column("orders", "agent_name")
    op.drop_column("orders", "agent_id")
    op.drop_column("orders", "customer_id")
