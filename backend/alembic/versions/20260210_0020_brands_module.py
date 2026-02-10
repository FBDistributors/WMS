"""Add brands module and product brand mapping.

Revision ID: 20260210_0020
Revises: 20260210_0019
Create Date: 2026-02-10 11:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260210_0020"
down_revision = "20260210_0019"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "brands",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False, unique=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_brands_code", "brands", ["code"])
    op.create_index("ix_brands_is_active", "brands", ["is_active"])

    op.add_column("products", sa.Column("brand_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("products", sa.Column("brand_code", sa.String(length=3), nullable=True))
    op.create_foreign_key(
        "fk_products_brand_id",
        "products",
        "brands",
        ["brand_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_products_brand_id", "products", ["brand_id"])
    op.create_index("ix_products_brand_code", "products", ["brand_code"])


def downgrade():
    op.drop_index("ix_products_brand_code", table_name="products")
    op.drop_index("ix_products_brand_id", table_name="products")
    op.drop_constraint("fk_products_brand_id", "products", type_="foreignkey")
    op.drop_column("products", "brand_code")
    op.drop_column("products", "brand_id")

    op.drop_index("ix_brands_is_active", table_name="brands")
    op.drop_index("ix_brands_code", table_name="brands")
    op.drop_table("brands")
