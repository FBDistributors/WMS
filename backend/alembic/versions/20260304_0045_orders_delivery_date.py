"""Add delivery_date to orders (SmartUP yetkazib berish sanasi).

Revision ID: 20260304_0045
Revises: 20260303_0044
Create Date: 2026-03-04

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260304_0045"
down_revision = "20260303_0044"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "orders",
        sa.Column("delivery_date", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("orders", "delivery_date")
