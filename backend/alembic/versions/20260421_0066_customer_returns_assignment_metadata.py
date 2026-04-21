"""Add assignment metadata to customer_returns.

Revision ID: 20260421_0066
Revises: 20260421_0065
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260421_0066"
down_revision = "20260421_0065"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "customer_returns",
        sa.Column("assigned_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "customer_returns",
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_customer_returns_assigned_by_user_id_users",
        "customer_returns",
        "users",
        ["assigned_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_customer_returns_assigned_by_user_id",
        "customer_returns",
        ["assigned_by_user_id"],
    )


def downgrade():
    op.drop_index("ix_customer_returns_assigned_by_user_id", table_name="customer_returns")
    op.drop_constraint(
        "fk_customer_returns_assigned_by_user_id_users",
        "customer_returns",
        type_="foreignkey",
    )
    op.drop_column("customer_returns", "assigned_at")
    op.drop_column("customer_returns", "assigned_by_user_id")
