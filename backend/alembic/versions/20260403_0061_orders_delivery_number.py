"""orders.delivery_number — tashkiliy harakat yetkazib berish raqami.

Revision ID: 20260403_0061
Revises: 20260403_0060
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260403_0061"
down_revision = "20260403_0060"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("orders", sa.Column("delivery_number", sa.String(length=64), nullable=True))


def downgrade():
    op.drop_column("orders", "delivery_number")
