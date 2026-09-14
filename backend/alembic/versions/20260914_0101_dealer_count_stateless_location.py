"""Diller sanovi — holatsiz model va qator joyi (javon / zona).

Holat foydalanuvchidan yashiriladi: ichki `open` (dillerning faol sanovi) / `closed`
(yangisi yaratilgan). Qatorga `location_code` qo'shiladi — bir tovar ikki joyda bo'lsa
ikki qator, shuning uchun yagona indeks joyni ham o'z ichiga oladi.

Revision ID: 20260914_0101
Revises: 20260914_0100
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260914_0101"
down_revision = "20260914_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_dealer_stock_counts_status", "dealer_stock_counts", type_="check")
    op.execute("UPDATE dealer_stock_counts SET status = CASE WHEN status = 'submitted' THEN 'closed' ELSE 'open' END")
    op.create_check_constraint(
        "ck_dealer_stock_counts_status", "dealer_stock_counts", "status IN ('open', 'closed')"
    )

    op.add_column("dealer_stock_count_lines", sa.Column("location_code", sa.String(length=32), nullable=True))
    op.drop_index("ux_dealer_stock_count_lines_product_expiry", table_name="dealer_stock_count_lines")
    op.create_index(
        "ux_dealer_stock_count_lines_product_expiry_loc",
        "dealer_stock_count_lines",
        ["count_id", "product_id", "expiry_date", "location_code"],
        unique=True,
        postgresql_where=sa.text("product_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_dealer_stock_count_lines_product_expiry_loc", table_name="dealer_stock_count_lines")
    # Joy bo'yicha ajralgan qatorlar eski indeksga sig'maydi — joysiz qatorlar qoladi.
    op.execute(
        "DELETE FROM dealer_stock_count_lines WHERE location_code IS NOT NULL AND product_id IS NOT NULL"
    )
    op.create_index(
        "ux_dealer_stock_count_lines_product_expiry",
        "dealer_stock_count_lines",
        ["count_id", "product_id", "expiry_date"],
        unique=True,
        postgresql_where=sa.text("product_id IS NOT NULL"),
    )
    op.drop_column("dealer_stock_count_lines", "location_code")

    op.drop_constraint("ck_dealer_stock_counts_status", "dealer_stock_counts", type_="check")
    op.execute("UPDATE dealer_stock_counts SET status = CASE WHEN status = 'closed' THEN 'submitted' ELSE 'draft' END")
    op.create_check_constraint(
        "ck_dealer_stock_counts_status", "dealer_stock_counts", "status IN ('draft', 'in_progress', 'submitted')"
    )
