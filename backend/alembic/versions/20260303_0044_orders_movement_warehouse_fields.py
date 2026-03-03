"""Add from_warehouse_code, to_warehouse_code, movement_note to orders (tashkiliy harakat).

Revision ID: 20260303_0044
Revises: 20260303_0043
Create Date: 2026-03-03

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260303_0044"
down_revision = "20260303_0043"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("orders", sa.Column("from_warehouse_code", sa.String(length=64), nullable=True))
    op.add_column("orders", sa.Column("to_warehouse_code", sa.String(length=64), nullable=True))
    op.add_column("orders", sa.Column("movement_note", sa.String(length=512), nullable=True))


def downgrade():
    op.drop_column("orders", "movement_note")
    op.drop_column("orders", "to_warehouse_code")
    op.drop_column("orders", "from_warehouse_code")
