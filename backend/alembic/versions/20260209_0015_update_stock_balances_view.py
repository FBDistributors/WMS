"""Update stock balances view to ignore pick movements.

Revision ID: 20260209_0015
Revises: 20260209_0014
Create Date: 2026-02-09 20:00:00.000000
"""
from __future__ import annotations

from alembic import op

revision = "20260209_0015"
down_revision = "20260209_0014"
branch_labels = None
depends_on = None


def upgrade():
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


def downgrade():
    op.execute("DROP VIEW IF EXISTS stock_balances")
    op.execute(
        """
        CREATE VIEW stock_balances AS
        SELECT
            lot_id,
            location_id,
            SUM(qty_change) AS qty
        FROM stock_movements
        GROUP BY lot_id, location_id
        """
    )
