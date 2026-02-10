"""Add inventory fields to document lines.

Revision ID: 20260209_0014
Revises: 20260209_0013
Create Date: 2026-02-09 19:10:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260209_0014"
down_revision = "20260209_0013"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("document_lines", sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("document_lines", sa.Column("lot_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("document_lines", sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("document_lines", sa.Column("batch", sa.String(length=64), nullable=True))
    op.add_column("document_lines", sa.Column("expiry_date", sa.Date(), nullable=True))

    op.create_foreign_key(
        "fk_document_lines_product_id",
        "document_lines",
        "products",
        ["product_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_document_lines_lot_id",
        "document_lines",
        "stock_lots",
        ["lot_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_document_lines_location_id",
        "document_lines",
        "locations",
        ["location_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    op.create_index("ix_document_lines_product_id", "document_lines", ["product_id"])
    op.create_index("ix_document_lines_lot_id", "document_lines", ["lot_id"])
    op.create_index("ix_document_lines_location_id", "document_lines", ["location_id"])


def downgrade():
    op.drop_index("ix_document_lines_location_id", table_name="document_lines")
    op.drop_index("ix_document_lines_lot_id", table_name="document_lines")
    op.drop_index("ix_document_lines_product_id", table_name="document_lines")
    op.drop_constraint("fk_document_lines_location_id", "document_lines", type_="foreignkey")
    op.drop_constraint("fk_document_lines_lot_id", "document_lines", type_="foreignkey")
    op.drop_constraint("fk_document_lines_product_id", "document_lines", type_="foreignkey")
    op.drop_column("document_lines", "expiry_date")
    op.drop_column("document_lines", "batch")
    op.drop_column("document_lines", "location_id")
    op.drop_column("document_lines", "lot_id")
    op.drop_column("document_lines", "product_id")
