"""product_boxes — quti shtrix-kodi va mahsulot bog'lanishi.

Revision ID: 20260608_0083
Revises: 20260605_0082
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260608_0083"
down_revision = "20260605_0082"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_boxes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("box_barcode", sa.String(length=64), nullable=False),
        sa.Column("product_id", sa.UUID(), nullable=False),
        sa.Column("units_per_box", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("box_barcode", name="uq_product_boxes_box_barcode"),
        sa.CheckConstraint("units_per_box > 0", name="ck_product_boxes_units_per_box_positive"),
    )
    op.create_index("ix_product_boxes_box_barcode", "product_boxes", ["box_barcode"])
    op.create_index("ix_product_boxes_product_id", "product_boxes", ["product_id"])
    op.create_index("ix_product_boxes_is_active", "product_boxes", ["is_active"])


def downgrade() -> None:
    op.drop_index("ix_product_boxes_is_active", table_name="product_boxes")
    op.drop_index("ix_product_boxes_product_id", table_name="product_boxes")
    op.drop_index("ix_product_boxes_box_barcode", table_name="product_boxes")
    op.drop_table("product_boxes")
