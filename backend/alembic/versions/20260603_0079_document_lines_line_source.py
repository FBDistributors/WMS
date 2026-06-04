"""document_lines: add line_source for promo/gift picking display."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260603_0079"
down_revision = "20260603_0078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "document_lines",
        sa.Column(
            "line_source",
            sa.String(16),
            nullable=True,
            server_default=sa.text("'product'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("document_lines", "line_source")
