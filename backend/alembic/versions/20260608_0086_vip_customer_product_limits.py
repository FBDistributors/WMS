"""VIP mijoz mahsulot bo'yicha muddat chegarasi.

Revision ID: 20260608_0086
Revises: 20260608_0085
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260608_0086"
down_revision = "20260608_0085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vip_customer_product_limits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("vip_customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("min_expiry_months", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["vip_customer_id"], ["vip_customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("vip_customer_id", "product_id", name="uq_vip_customer_product_limits_vip_product"),
    )
    op.create_index(
        "ix_vip_customer_product_limits_vip_customer_id",
        "vip_customer_product_limits",
        ["vip_customer_id"],
    )
    op.create_index(
        "ix_vip_customer_product_limits_product_id",
        "vip_customer_product_limits",
        ["product_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_vip_customer_product_limits_product_id", table_name="vip_customer_product_limits")
    op.drop_index("ix_vip_customer_product_limits_vip_customer_id", table_name="vip_customer_product_limits")
    op.drop_table("vip_customer_product_limits")
