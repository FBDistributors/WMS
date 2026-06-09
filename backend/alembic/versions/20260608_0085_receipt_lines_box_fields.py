"""receipt_lines — quti bo'yicha qabul maydonlari.

Revision ID: 20260608_0085
Revises: 20260608_0084
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260608_0085"
down_revision = "20260608_0084"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "receipt_lines",
        sa.Column("box_barcode", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "receipt_lines",
        sa.Column("box_count", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("receipt_lines", "box_count")
    op.drop_column("receipt_lines", "box_barcode")
