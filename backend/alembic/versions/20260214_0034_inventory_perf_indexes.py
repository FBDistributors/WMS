"""Add indexes for inventory performance.

Revision ID: 20260214_0034
Revises: 20260214_0033
Create Date: 2026-02-14 18:00:00.000000

Note: stock_movements (product_id, lot_id, location_id, created_at) and
stock_lots (product_id, expiry_date) indexes already exist from prior migrations.
"""
from __future__ import annotations

from alembic import op

revision = "20260214_0034"
down_revision = "20260214_0033"
branch_labels = None
depends_on = None


def upgrade():
    # Locations code index for faster lookups (if not exists from unique)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_locations_code ON locations (code)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_locations_code")
