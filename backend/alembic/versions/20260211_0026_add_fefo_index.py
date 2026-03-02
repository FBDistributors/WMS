"""Add composite index for FEFO queries

Revision ID: 20260211_0026
Revises: 20260210_0021
Create Date: 2026-02-11 17:00:00.000000
"""
from alembic import op

revision = "20260211_0026"
down_revision = "20260210_0021"
branch_labels = None
depends_on = None


def upgrade():
    # Composite index for FEFO optimization
    # Speeds up: SELECT * FROM stock_lots WHERE product_id = ? ORDER BY expiry_date ASC
    op.create_index(
        "ix_stock_lots_fefo",
        "stock_lots",
        ["product_id", "expiry_date", "id"],
    )


def downgrade():
    op.drop_index("ix_stock_lots_fefo", table_name="stock_lots")
