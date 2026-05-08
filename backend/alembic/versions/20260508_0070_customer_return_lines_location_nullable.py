"""Allow customer return line location to be null at create stage.

Revision ID: 20260508_0070
Revises: 20260507_0067
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260508_0070"
down_revision = "20260507_0067"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "customer_return_lines",
        "location_id",
        existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
        nullable=True,
    )


def downgrade():
    op.alter_column(
        "customer_return_lines",
        "location_id",
        existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
        nullable=False,
    )
