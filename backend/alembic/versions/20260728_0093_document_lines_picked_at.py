"""document_lines: yig'uvchi miqdorni tasdiqlagan vaqt (picked_at).

- `document_lines.picked_at`: pozitsiyani skanerlab miqdor tasdiqlangan oxirgi vaqt.
  Qator to'liq terilganda bu — pozitsiyani yakunlash vaqti.
- Backfill: eski qatorlar uchun `stock_movements` dagi `pick` yozuvlarining
  MAX(created_at) qiymati. Hujjatda bir xil (mahsulot+lot+joy) juftligi bir necha
  qatorda uchrasa, ular bir xil vaqtni oladi — taxminiy, lekin bo'shdan yaxshiroq.

Revision ID: 20260728_0093
Revises: 20260723_0092
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260728_0093"
down_revision = "20260723_0092"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "document_lines",
        sa.Column("picked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        UPDATE document_lines AS dl
           SET picked_at = mv.last_picked_at
          FROM (
                SELECT source_document_id,
                       product_id,
                       lot_id,
                       location_id,
                       MAX(created_at) AS last_picked_at
                  FROM stock_movements
                 WHERE movement_type = 'pick'
                   AND source_document_type = 'document'
                   AND source_document_id IS NOT NULL
                 GROUP BY source_document_id, product_id, lot_id, location_id
               ) AS mv
         WHERE dl.picked_at IS NULL
           AND dl.picked_qty > 0
           AND dl.document_id = mv.source_document_id
           AND dl.product_id = mv.product_id
           AND dl.lot_id = mv.lot_id
           AND dl.location_id = mv.location_id
        """
    )


def downgrade() -> None:
    op.drop_column("document_lines", "picked_at")
