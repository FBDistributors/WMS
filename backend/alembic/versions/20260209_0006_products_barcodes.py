"""Add product barcodes and product details.

Revision ID: 20260209_0006
Revises: 20260208_0005
Create Date: 2026-02-09 10:30:00.000000
"""
from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260209_0006"
down_revision = "20260208_0005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("products", sa.Column("brand", sa.String(length=128), nullable=True))
    op.add_column("products", sa.Column("category", sa.String(length=128), nullable=True))
    op.add_column("products", sa.Column("photo_url", sa.String(length=512), nullable=True))
    op.create_index("ix_products_sku", "products", ["sku"])
    op.create_index("ix_products_name", "products", ["name"])

    op.create_table(
        "product_barcodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("barcode", sa.String(length=64), nullable=False, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_product_barcodes_barcode", "product_barcodes", ["barcode"])

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, barcode FROM products WHERE barcode IS NOT NULL")
    ).fetchall()
    for row in rows:
        conn.execute(
            sa.text(
                "INSERT INTO product_barcodes (id, product_id, barcode) "
                "VALUES (:id, :product_id, :barcode)"
            ),
            {"id": uuid.uuid4(), "product_id": row.id, "barcode": row.barcode},
        )

    op.drop_index("ix_products_barcode", table_name="products")
    op.drop_column("products", "barcode")


def downgrade():
    op.add_column("products", sa.Column("barcode", sa.String(length=64), nullable=True))
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT product_id, barcode FROM product_barcodes")
    ).fetchall()
    for row in rows:
        conn.execute(
            sa.text("UPDATE products SET barcode = :barcode WHERE id = :product_id"),
            {"barcode": row.barcode, "product_id": row.product_id},
        )

    op.create_index("ix_products_barcode", "products", ["barcode"])
    op.drop_index("ix_product_barcodes_barcode", table_name="product_barcodes")
    op.drop_table("product_barcodes")
    op.drop_index("ix_products_name", table_name="products")
    op.drop_index("ix_products_sku", table_name="products")
    op.drop_column("products", "photo_url")
    op.drop_column("products", "category")
    op.drop_column("products", "brand")
