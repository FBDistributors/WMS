"""SmartUp mijoz qaytarishlari (mdeal/return$export) — sinxron jadvallari.

Revision ID: 20260714_0090
Revises: 20260627_0089
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260714_0090"
down_revision = "20260627_0089"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "smartup_returns",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("deal_id", sa.String(length=64), nullable=False),
        sa.Column("order_deal_id", sa.String(length=64), nullable=True),
        sa.Column("external_id", sa.String(length=64), nullable=True),
        sa.Column("return_date", sa.Date(), nullable=True),
        sa.Column("deal_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("person_code", sa.String(length=64), nullable=True),
        sa.Column("person_name", sa.String(length=255), nullable=True),
        sa.Column("person_tin", sa.String(length=32), nullable=True),
        sa.Column("filial_code", sa.String(length=64), nullable=True),
        sa.Column("return_reason_id", sa.String(length=64), nullable=True),
        sa.Column("return_reason_code", sa.String(length=64), nullable=True),
        sa.Column("sales_manager_code", sa.String(length=64), nullable=True),
        sa.Column("sales_manager_name", sa.String(length=255), nullable=True),
        sa.Column("total_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("currency_code", sa.String(length=16), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=True),
        sa.Column("note", sa.String(length=1024), nullable=True),
        sa.Column("wms_status", sa.String(length=24), server_default="new", nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("deal_id", name="uq_smartup_returns_deal_id"),
    )
    op.create_index("ix_smartup_returns_return_date", "smartup_returns", ["return_date"])
    op.create_index("ix_smartup_returns_person_code", "smartup_returns", ["person_code"])
    op.create_index("ix_smartup_returns_wms_status", "smartup_returns", ["wms_status"])

    op.create_table(
        "smartup_return_lines",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("return_id", sa.UUID(), nullable=False),
        sa.Column("product_code", sa.String(length=64), nullable=True),
        sa.Column("product_article_code", sa.String(length=64), nullable=True),
        sa.Column("product_name", sa.String(length=512), nullable=True),
        sa.Column("return_quant", sa.Numeric(18, 3), nullable=True),
        sa.Column("product_price", sa.Numeric(18, 2), nullable=True),
        sa.Column("sold_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("expiry_date", sa.String(length=32), nullable=True),
        sa.Column("serial_number", sa.String(length=128), nullable=True),
        sa.Column("warehouse_code", sa.String(length=64), nullable=True),
        sa.Column("action_name", sa.String(length=255), nullable=True),
        sa.Column("line_no", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["return_id"], ["smartup_returns.id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_smartup_return_lines_return_id", "smartup_return_lines", ["return_id"])


def downgrade() -> None:
    op.drop_index("ix_smartup_return_lines_return_id", table_name="smartup_return_lines")
    op.drop_table("smartup_return_lines")
    op.drop_index("ix_smartup_returns_wms_status", table_name="smartup_returns")
    op.drop_index("ix_smartup_returns_person_code", table_name="smartup_returns")
    op.drop_index("ix_smartup_returns_return_date", table_name="smartup_returns")
    op.drop_table("smartup_returns")
