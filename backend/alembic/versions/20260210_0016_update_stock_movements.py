"""Update stock movements schema and constraints.

Revision ID: 20260210_0016
Revises: 20260209_0015
Create Date: 2026-02-10 09:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260210_0016"
down_revision = "20260209_0015"
branch_labels = None
depends_on = None


MOVEMENT_TYPES = (
    "opening_balance",
    "receipt",
    "putaway",
    "allocate",
    "unallocate",
    "pick",
    "ship",
    "adjust",
    "transfer_in",
    "transfer_out",
)


def upgrade():
    op.execute("DROP VIEW IF EXISTS inventory_by_lot_location")
    op.execute("DROP VIEW IF EXISTS stock_balances")
    op.alter_column(
        "stock_movements",
        "qty_change",
        type_=sa.Numeric(18, 3),
        existing_type=sa.Numeric(14, 3),
        nullable=False,
    )
    op.alter_column(
        "stock_movements",
        "created_by",
        new_column_name="created_by_user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.drop_constraint("ck_stock_movements_type", "stock_movements", type_="check")
    op.create_check_constraint(
        "ck_stock_movements_type",
        "stock_movements",
        f"movement_type IN {MOVEMENT_TYPES}",
    )
    op.create_index(
        "ix_stock_movements_product_lot_location",
        "stock_movements",
        ["product_id", "lot_id", "location_id"],
    )


def downgrade():
    op.drop_index("ix_stock_movements_product_lot_location", table_name="stock_movements")
    op.drop_constraint("ck_stock_movements_type", "stock_movements", type_="check")
    op.create_check_constraint(
        "ck_stock_movements_type",
        "stock_movements",
        "movement_type IN ('receipt','putaway','allocate','pick','ship','adjust')",
    )
    op.alter_column(
        "stock_movements",
        "created_by_user_id",
        new_column_name="created_by",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.alter_column(
        "stock_movements",
        "qty_change",
        type_=sa.Numeric(14, 3),
        existing_type=sa.Numeric(18, 3),
        nullable=False,
    )
    op.execute(
        """
        CREATE VIEW stock_balances AS
        SELECT
            lot_id,
            location_id,
            SUM(qty_change) AS qty
        FROM stock_movements
        WHERE movement_type <> 'pick'
        GROUP BY lot_id, location_id
        """
    )
