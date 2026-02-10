"""Add Smartup product fields.

Revision ID: 20260210_0018
Revises: 20260210_0017
Create Date: 2026-02-10 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260210_0018"
down_revision = "20260210_0017"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "products",
        sa.Column(
            "external_source",
            sa.String(length=32),
            nullable=True,
            server_default="smartup",
        ),
    )
    op.add_column("products", sa.Column("external_id", sa.String(length=128), nullable=True))
    op.add_column("products", sa.Column("smartup_code", sa.String(length=64), nullable=True))
    op.add_column("products", sa.Column("short_name", sa.String(length=128), nullable=True))
    op.add_column("products", sa.Column("barcode", sa.String(length=64), nullable=True))
    op.add_column("products", sa.Column("article_code", sa.String(length=64), nullable=True))
    op.add_column("products", sa.Column("smartup_groups", postgresql.JSONB, nullable=True))
    op.add_column("products", sa.Column("raw_payload", postgresql.JSONB, nullable=True))

    op.execute(
        """
        UPDATE products
        SET external_source = 'smartup',
            external_id = COALESCE(external_id, sku),
            smartup_code = COALESCE(smartup_code, sku)
        WHERE external_id IS NULL OR smartup_code IS NULL OR external_source IS NULL
        """
    )

    op.alter_column("products", "external_source", nullable=False)
    op.alter_column("products", "external_id", nullable=False)

    op.create_unique_constraint(
        "uq_products_external_source_external_id",
        "products",
        ["external_source", "external_id"],
    )
    op.create_index("ix_products_external_id", "products", ["external_id"])
    op.create_index("ix_products_smartup_code", "products", ["smartup_code"])
    op.create_index("ix_products_barcode", "products", ["barcode"])
    op.create_index("ix_products_is_active", "products", ["is_active"])


def downgrade():
    op.drop_index("ix_products_is_active", table_name="products")
    op.drop_index("ix_products_barcode", table_name="products")
    op.drop_index("ix_products_smartup_code", table_name="products")
    op.drop_index("ix_products_external_id", table_name="products")
    op.drop_constraint("uq_products_external_source_external_id", "products", type_="unique")
    op.drop_column("products", "raw_payload")
    op.drop_column("products", "smartup_groups")
    op.drop_column("products", "article_code")
    op.drop_column("products", "barcode")
    op.drop_column("products", "short_name")
    op.drop_column("products", "smartup_code")
    op.drop_column("products", "external_id")
    op.drop_column("products", "external_source")
