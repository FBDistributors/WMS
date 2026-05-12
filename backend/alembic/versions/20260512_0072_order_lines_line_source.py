"""order_lines: add line_source column for promo/gift detection."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260512_0072"
down_revision = "20260511_0071"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "order_lines",
        sa.Column(
            "line_source",
            sa.String(16),
            nullable=True,
            server_default=sa.text("'product'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("order_lines", "line_source")
