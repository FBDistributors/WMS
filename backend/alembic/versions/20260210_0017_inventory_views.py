"""Create inventory aggregation views.

Revision ID: 20260210_0017
Revises: 20260210_0016
Create Date: 2026-02-10 09:05:00.000000
"""
from __future__ import annotations

from alembic import op

revision = "20260210_0017"
down_revision = "20260210_0016"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("DROP VIEW IF EXISTS inventory_by_lot_location")
    op.execute("DROP VIEW IF EXISTS stock_balances")
    op.execute(
        """
        CREATE VIEW stock_balances AS
        SELECT
            lot_id,
            location_id,
            SUM(qty_change) AS qty
        FROM stock_movements
        WHERE movement_type NOT IN ('allocate', 'unallocate')
        GROUP BY lot_id, location_id
        """
    )
    op.execute(
        """
        CREATE VIEW inventory_by_lot_location AS
        SELECT
            lot_id,
            location_id,
            SUM(CASE WHEN movement_type IN ('allocate', 'unallocate') THEN 0 ELSE qty_change END) AS on_hand,
            SUM(CASE WHEN movement_type IN ('allocate', 'unallocate') THEN qty_change ELSE 0 END) AS reserved,
            SUM(CASE WHEN movement_type IN ('allocate', 'unallocate') THEN 0 ELSE qty_change END)
              - SUM(CASE WHEN movement_type IN ('allocate', 'unallocate') THEN qty_change ELSE 0 END) AS available
        FROM stock_movements
        GROUP BY lot_id, location_id
        """
    )


def downgrade():
    op.execute("DROP VIEW IF EXISTS inventory_by_lot_location")
    op.execute("DROP VIEW IF EXISTS stock_balances")
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
