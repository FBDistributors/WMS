"""dealer_stock_counts: diller ombor qoldig'i sanovi (WMS ledgeridan alohida).

Revision ID: 20260911_0098
Revises: 20260826_0097
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260911_0098"
down_revision = "20260826_0097"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dealer_stock_counts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("client_uuid", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("dealer_org_id", sa.String(length=64), nullable=False),
        sa.Column("dealer_name", sa.String(length=255), nullable=True),
        sa.Column(
            "counted_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("lines_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_units", sa.Numeric(14, 3), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.CheckConstraint("status IN ('draft', 'submitted')", name="ck_dealer_stock_counts_status"),
    )
    op.create_index("ix_dealer_stock_counts_dealer_org_id", "dealer_stock_counts", ["dealer_org_id"])
    op.create_index("ix_dealer_stock_counts_counted_by", "dealer_stock_counts", ["counted_by_user_id"])
    op.create_index(
        "ix_dealer_stock_counts_status_created", "dealer_stock_counts", ["status", "created_at"]
    )

    op.create_table(
        "dealer_stock_count_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "count_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dealer_stock_counts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("scanned_barcode", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("qty", sa.Numeric(12, 3), nullable=False),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seq", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("qty > 0", name="ck_dealer_stock_count_lines_qty_positive"),
    )
    op.create_index("ix_dealer_stock_count_lines_count_id", "dealer_stock_count_lines", ["count_id"])
    op.create_index(
        "ix_dealer_stock_count_lines_product_id", "dealer_stock_count_lines", ["product_id"]
    )
    op.create_index(
        "ux_dealer_stock_count_lines_product_expiry",
        "dealer_stock_count_lines",
        ["count_id", "product_id", "expiry_date"],
        unique=True,
        postgresql_where=sa.text("product_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_dealer_stock_count_lines_product_expiry", table_name="dealer_stock_count_lines")
    op.drop_index("ix_dealer_stock_count_lines_product_id", table_name="dealer_stock_count_lines")
    op.drop_index("ix_dealer_stock_count_lines_count_id", table_name="dealer_stock_count_lines")
    op.drop_table("dealer_stock_count_lines")
    op.drop_index("ix_dealer_stock_counts_status_created", table_name="dealer_stock_counts")
    op.drop_index("ix_dealer_stock_counts_counted_by", table_name="dealer_stock_counts")
    op.drop_index("ix_dealer_stock_counts_dealer_org_id", table_name="dealer_stock_counts")
    op.drop_table("dealer_stock_counts")
