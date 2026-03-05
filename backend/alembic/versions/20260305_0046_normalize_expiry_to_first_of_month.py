"""Normalize expiry_date to first day of month (Yil keyin Oy).

Revision ID: 20260305_0046
Revises: 20260304_0045
Create Date: 2026-03-05

"""
from __future__ import annotations

from alembic import op

revision = "20260305_0046"
down_revision = "20260304_0045"
branch_labels = None
depends_on = None


def upgrade():
    # stock_lots.expiry_date -> oyning 1-kuni
    op.execute(
        "UPDATE stock_lots SET expiry_date = date_trunc('month', expiry_date)::date WHERE expiry_date IS NOT NULL"
    )
    # document_lines.expiry_date
    op.execute(
        "UPDATE document_lines SET expiry_date = date_trunc('month', expiry_date)::date WHERE expiry_date IS NOT NULL"
    )
    # receipt_lines.expiry_date
    op.execute(
        "UPDATE receipt_lines SET expiry_date = date_trunc('month', expiry_date)::date WHERE expiry_date IS NOT NULL"
    )


def downgrade():
    # No reversible conversion (we cannot restore original day)
    pass
