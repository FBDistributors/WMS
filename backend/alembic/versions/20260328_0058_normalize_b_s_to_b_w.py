"""Normalize legacy SmartUp order status B#S to B#W.

Revision ID: 20260328_0058
Revises: 20260327_0057
Create Date: 2026-03-28

WMS endi faqat B#W import qiladi; eski B#S qatorlarni B#W ga birlashtiramiz.
"""
from __future__ import annotations

from alembic import op

revision = "20260328_0058"
down_revision = "20260327_0057"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE order_wms_state SET status = 'B#W' WHERE status = 'B#S'")


def downgrade():
    # Old status lar aniqlanmaydi; rollback qilinmasin.
    pass
