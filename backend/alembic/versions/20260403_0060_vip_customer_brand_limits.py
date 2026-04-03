"""VIP mijoz brend bo'yicha muddat chegarasi.

Revision ID: 20260403_0060
Revises: 20260329_0059
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260403_0060"
down_revision = "20260329_0059"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "vip_customer_brand_limits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("vip_customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("brand_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("min_expiry_months", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["vip_customer_id"], ["vip_customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["brand_id"], ["brands.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("vip_customer_id", "brand_id", name="uq_vip_customer_brand_limits_vip_brand"),
    )
    op.create_index(
        "ix_vip_customer_brand_limits_vip_customer_id",
        "vip_customer_brand_limits",
        ["vip_customer_id"],
    )
    op.create_index(
        "ix_vip_customer_brand_limits_brand_id",
        "vip_customer_brand_limits",
        ["brand_id"],
    )


def downgrade():
    op.drop_index("ix_vip_customer_brand_limits_brand_id", table_name="vip_customer_brand_limits")
    op.drop_index("ix_vip_customer_brand_limits_vip_customer_id", table_name="vip_customer_brand_limits")
    op.drop_table("vip_customer_brand_limits")
