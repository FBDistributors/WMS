"""Normalize expiry_date to first day of month (Yil keyin Oy).

Revision ID: 20260305_0046
Revises: 20260304_0045
Create Date: 2026-03-05

"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "20260305_0046"
down_revision = "20260304_0045"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # stock_lots: bir xil (product_id, batch, oy) da bir nechta lot bo'lsa, ularni birlashtirish
    # (expiry_date ni 1-kunga qisqarganda unique constraint buzilmasligi uchun)
    dup_rows = conn.execute(
        text("""
            SELECT product_id, batch, date_trunc('month', expiry_date)::date AS exp_month,
                   array_agg(id ORDER BY id) AS lot_ids
            FROM stock_lots
            WHERE expiry_date IS NOT NULL
            GROUP BY product_id, batch, date_trunc('month', expiry_date)::date
            HAVING count(*) > 1
        """)
    ).fetchall()

    for row in dup_rows:
        product_id, batch, exp_month, lot_ids = row[0], row[1], row[2], row[3]
        keeper_id = lot_ids[0]
        others = list(lot_ids[1:])
        if not others:
            continue
        # stock_movements da boshqa lot_id larni keeper ga yo'naltirish
        conn.execute(
            text("UPDATE stock_movements SET lot_id = :keeper WHERE lot_id = ANY(:others)"),
            {"keeper": keeper_id, "others": others},
        )
        # Takroriy lotlarni o'chirish
        conn.execute(
            text("DELETE FROM stock_lots WHERE id = ANY(:others)"),
            {"others": others},
        )

    # stock_lots.expiry_date -> oyning 1-kuni
    conn.execute(
        text(
            "UPDATE stock_lots SET expiry_date = date_trunc('month', expiry_date)::date WHERE expiry_date IS NOT NULL"
        )
    )

    # document_lines.expiry_date
    op.execute(
        "UPDATE document_lines SET expiry_date = date_trunc('month', expiry_date)::date WHERE expiry_date IS NOT NULL"
    )
    # receipt_lines.expiry_date
    op.execute(
        "UPDATE receipt_lines SET expiry_date = date_trunc('month', expiry_date)::date WHERE expiry_date IS NOT NULL"
    )


def downgrade():
    # No reversible conversion (we cannot restore original day)
    pass
