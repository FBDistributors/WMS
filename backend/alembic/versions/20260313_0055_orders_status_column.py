"""Add status column to orders table (for filtering); backfill from order_wms_state.

Revision ID: 20260313_0055
Revises: 20260312_0054
Create Date: 2026-03-13

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260313_0055"
down_revision = "20260312_0054"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "orders",
        sa.Column("status", sa.String(length=32), nullable=True),
    )
    op.create_index("ix_orders_status", "orders", ["status"])
    op.execute("""
        UPDATE orders o
        SET status = s.status
        FROM order_wms_state s
        WHERE o.id = s.order_id
    """)


def downgrade():
    op.drop_index("ix_orders_status", table_name="orders")
    op.drop_column("orders", "status")
