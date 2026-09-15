"""Diller sanovi — qatorning oxirgi o'zgargan vaqti (telefon onlayn yangilanishi uchun).

Telefon sanov ochiq turganda faqat o'zgargan qatorlarni so'raydi (`changed_since`). Bekor qilish
yoki web'da joy/muddat o'zgartirish `counted_at` ni yangilamaydi, shuning uchun alohida ustun.

Revision ID: 20260915_0103
Revises: 20260914_0102
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260915_0103"
down_revision = "20260914_0102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "dealer_stock_count_lines",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.execute("UPDATE dealer_stock_count_lines SET updated_at = COALESCE(counted_at, updated_at)")
    op.create_index(
        "ix_dealer_stock_count_lines_count_updated", "dealer_stock_count_lines", ["count_id", "updated_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_dealer_stock_count_lines_count_updated", table_name="dealer_stock_count_lines")
    op.drop_column("dealer_stock_count_lines", "updated_at")
