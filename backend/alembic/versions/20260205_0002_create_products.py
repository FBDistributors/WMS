"""Create products table.

Revision ID: 20260205_0002
Revises: 20260205_0001
Create Date: 2026-02-05 00:10:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260205_0002"
down_revision = "20260205_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False, unique=True),
        sa.Column("barcode", sa.String(length=64), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_products_barcode", "products", ["barcode"])


def downgrade():
    op.drop_index("ix_products_barcode", table_name="products")
    op.drop_table("products")
