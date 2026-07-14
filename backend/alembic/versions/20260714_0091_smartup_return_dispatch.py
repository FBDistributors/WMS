"""SmartUp qaytimni yig'uvchiga yuborish: customer_returns bilan bog'lash.

- smartup_returns.customer_return_id: yuborilganda yaratilgan customer_return.
- customer_returns.source: 'manual' | 'smartup' (kelib chiqishi).

Revision ID: 20260714_0091
Revises: 20260714_0090
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260714_0091"
down_revision = "20260714_0090"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "customer_returns",
        sa.Column("source", sa.String(length=16), server_default="manual", nullable=False),
    )
    op.add_column(
        "smartup_returns",
        sa.Column("customer_return_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_smartup_returns_customer_return_id",
        "smartup_returns",
        "customer_returns",
        ["customer_return_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_smartup_returns_customer_return_id",
        "smartup_returns",
        ["customer_return_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_smartup_returns_customer_return_id", table_name="smartup_returns")
    op.drop_constraint(
        "fk_smartup_returns_customer_return_id", "smartup_returns", type_="foreignkey"
    )
    op.drop_column("smartup_returns", "customer_return_id")
    op.drop_column("customer_returns", "source")
