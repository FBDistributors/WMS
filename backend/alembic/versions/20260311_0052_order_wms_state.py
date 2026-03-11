"""Add order_wms_state table; move status from orders to order_wms_state.

Revision ID: 20260311_0052
Revises: 20260308_0051
Create Date: 2026-03-11

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260311_0052"
down_revision = "20260308_0051"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "order_wms_state",
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="imported"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("order_id"),
    )
    op.create_index("ix_order_wms_state_status", "order_wms_state", ["status"])

    # Backfill: copy status and updated_at from orders into order_wms_state
    op.execute("""
        INSERT INTO order_wms_state (order_id, status, updated_at)
        SELECT id, status, updated_at FROM orders
    """)

    op.drop_index("ix_orders_status", table_name="orders")
    op.drop_column("orders", "status")


def downgrade():
    op.add_column(
        "orders",
        sa.Column("status", sa.String(length=32), nullable=False, server_default="imported"),
    )
    op.create_index("ix_orders_status", "orders", ["status"])

    # Copy back from order_wms_state (orders that have state)
    op.execute("""
        UPDATE orders o
        SET status = s.status
        FROM order_wms_state s
        WHERE o.id = s.order_id
    """)
    # Orders without state keep default 'imported'

    op.drop_index("ix_order_wms_state_status", table_name="order_wms_state")
    op.drop_table("order_wms_state")
