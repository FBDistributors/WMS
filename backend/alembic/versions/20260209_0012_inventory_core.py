"""Add inventory core ledger tables.

Revision ID: 20260209_0012
Revises: 20260209_0011
Create Date: 2026-02-09 18:10:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260209_0012"
down_revision = "20260209_0011"
branch_labels = None
depends_on = None


MOVEMENT_TYPES = ("receipt", "putaway", "allocate", "pick", "ship", "adjust")


def upgrade():
    op.create_table(
        "stock_lots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("batch", sa.String(length=64), nullable=False),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("product_id", "batch", "expiry_date", name="uq_stock_lots_product_batch_expiry"),
    )
    op.create_index("ix_stock_lots_product_id", "stock_lots", ["product_id"])
    op.create_index("ix_stock_lots_expiry_date", "stock_lots", ["expiry_date"])

    op.create_table(
        "stock_movements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "lot_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("stock_lots.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "location_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("locations.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("qty_change", sa.Numeric(14, 3), nullable=False),
        sa.Column("movement_type", sa.String(length=32), nullable=False),
        sa.Column("source_document_type", sa.String(length=32), nullable=True),
        sa.Column("source_document_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.CheckConstraint("qty_change <> 0", name="ck_stock_movements_qty_nonzero"),
        sa.CheckConstraint(
            "movement_type IN {}".format(MOVEMENT_TYPES),
            name="ck_stock_movements_type",
        ),
    )
    op.create_index("ix_stock_movements_product_id", "stock_movements", ["product_id"])
    op.create_index("ix_stock_movements_lot_id", "stock_movements", ["lot_id"])
    op.create_index("ix_stock_movements_location_id", "stock_movements", ["location_id"])
    op.create_index("ix_stock_movements_type", "stock_movements", ["movement_type"])
    op.create_index("ix_stock_movements_created_at", "stock_movements", ["created_at"])
    op.create_index(
        "ix_stock_movements_source_doc",
        "stock_movements",
        ["source_document_type", "source_document_id"],
    )

    op.execute(
        """
        CREATE VIEW stock_balances AS
        SELECT
            lot_id,
            location_id,
            SUM(qty_change) AS qty
        FROM stock_movements
        GROUP BY lot_id, location_id
        """
    )


def downgrade():
    op.execute("DROP VIEW IF EXISTS stock_balances")
    op.drop_index("ix_stock_movements_source_doc", table_name="stock_movements")
    op.drop_index("ix_stock_movements_created_at", table_name="stock_movements")
    op.drop_index("ix_stock_movements_type", table_name="stock_movements")
    op.drop_index("ix_stock_movements_location_id", table_name="stock_movements")
    op.drop_index("ix_stock_movements_lot_id", table_name="stock_movements")
    op.drop_index("ix_stock_movements_product_id", table_name="stock_movements")
    op.drop_table("stock_movements")
    op.drop_index("ix_stock_lots_expiry_date", table_name="stock_lots")
    op.drop_index("ix_stock_lots_product_id", table_name="stock_lots")
    op.drop_table("stock_lots")
