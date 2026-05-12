"""document_lines: VIP muddat ma'lumot qatorlari."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260511_0071"
down_revision = ("20260424_0069", "20260508_0070")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "document_lines",
        sa.Column(
            "is_vip_expiry_informational",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("document_lines", "is_vip_expiry_informational")
