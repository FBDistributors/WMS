"""Normalize order_wms_state to canonical WMS statuses (no B#W / ready_for_picking stored).

Revision ID: 20260424_0069
Revises: 20260423_0068

- B#W, B#S -> imported
- ready_for_picking -> allocated if SO picking document exists for order, else imported
"""
from __future__ import annotations

from alembic import op

revision = "20260424_0069"
down_revision = "20260423_0068"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        UPDATE order_wms_state
        SET status = 'imported'
        WHERE status IN ('B#W', 'B#S')
        """
    )
    op.execute(
        """
        UPDATE order_wms_state ows
        SET status = 'allocated'
        FROM documents d
        WHERE ows.order_id = d.order_id
          AND d.doc_type = 'SO'
          AND ows.status = 'ready_for_picking'
        """
    )
    op.execute(
        """
        UPDATE order_wms_state
        SET status = 'imported'
        WHERE status = 'ready_for_picking'
        """
    )


def downgrade():
    # Old values cannot be reconstructed.
    pass
