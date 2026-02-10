"""Add receiving receipts and lines.

Revision ID: 20260209_0013
Revises: 20260209_0012
Create Date: 2026-02-09 18:35:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260209_0013"
down_revision = "20260209_0012"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "receipts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("doc_no", sa.String(length=64), nullable=False, unique=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_receipts_status", "receipts", ["status"])
    op.create_index("ix_receipts_created_at", "receipts", ["created_at"])

    op.create_table(
        "receipt_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "receipt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("receipts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("qty", sa.Numeric(14, 3), nullable=False),
        sa.Column("batch", sa.String(length=64), nullable=False),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column(
            "location_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("locations.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_receipt_lines_receipt_id", "receipt_lines", ["receipt_id"])
    op.create_index("ix_receipt_lines_product_id", "receipt_lines", ["product_id"])
    op.create_index("ix_receipt_lines_location_id", "receipt_lines", ["location_id"])


def downgrade():
    op.drop_index("ix_receipt_lines_location_id", table_name="receipt_lines")
    op.drop_index("ix_receipt_lines_product_id", table_name="receipt_lines")
    op.drop_index("ix_receipt_lines_receipt_id", table_name="receipt_lines")
    op.drop_table("receipt_lines")
    op.drop_index("ix_receipts_created_at", table_name="receipts")
    op.drop_index("ix_receipts_status", table_name="receipts")
    op.drop_table("receipts")
