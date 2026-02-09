"""Add orders module and document assignment.

Revision ID: 20260209_0010
Revises: 20260209_0009
Create Date: 2026-02-09 13:10:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260209_0010"
down_revision = "20260209_0009"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="smartup"),
        sa.Column("source_external_id", sa.String(length=128), nullable=False),
        sa.Column("order_number", sa.String(length=64), nullable=False),
        sa.Column("filial_id", sa.String(length=64), nullable=True),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="imported"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_unique_constraint("uq_orders_source_external_id", "orders", ["source_external_id"])
    op.create_index("ix_orders_status", "orders", ["status"])
    op.create_index("ix_orders_order_number", "orders", ["order_number"])
    op.create_index("ix_orders_source", "orders", ["source"])
    op.create_index("ix_orders_filial_id", "orders", ["filial_id"])

    op.create_table(
        "order_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sku", sa.String(length=64), nullable=True),
        sa.Column("barcode", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("qty", sa.Float(), nullable=False, server_default="0"),
        sa.Column("uom", sa.String(length=32), nullable=True),
        sa.Column("raw_json", sa.JSON(), nullable=True),
    )
    op.create_index("ix_order_lines_order_id", "order_lines", ["order_id"])

    op.add_column(
        "documents",
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_documents_order_id",
        "documents",
        "orders",
        ["order_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "documents",
        sa.Column("assigned_to_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_documents_assigned_to_user_id",
        "documents",
        "users",
        ["assigned_to_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_documents_assigned_to_user_id", "documents", ["assigned_to_user_id"])


def downgrade():
    op.drop_index("ix_documents_assigned_to_user_id", table_name="documents")
    op.drop_constraint("fk_documents_assigned_to_user_id", "documents", type_="foreignkey")
    op.drop_column("documents", "assigned_to_user_id")
    op.drop_constraint("fk_documents_order_id", "documents", type_="foreignkey")
    op.drop_column("documents", "order_id")

    op.drop_index("ix_order_lines_order_id", table_name="order_lines")
    op.drop_table("order_lines")

    op.drop_index("ix_orders_filial_id", table_name="orders")
    op.drop_index("ix_orders_source", table_name="orders")
    op.drop_index("ix_orders_order_number", table_name="orders")
    op.drop_index("ix_orders_status", table_name="orders")
    op.drop_constraint("uq_orders_source_external_id", "orders", type_="unique")
    op.drop_table("orders")
