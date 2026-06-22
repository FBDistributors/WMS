"""document_lines: store picker-scanned box barcode for controller verification."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260622_0088"
down_revision = "20260609_0087"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "document_lines",
        sa.Column("picked_box_barcode", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("document_lines", "picked_box_barcode")
