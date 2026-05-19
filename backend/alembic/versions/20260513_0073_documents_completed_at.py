"""documents.completed_at — kontrolyor yakunlagan vaqt."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260513_0073"
down_revision = "20260512_0072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        UPDATE documents
        SET completed_at = updated_at
        WHERE status = 'completed' AND completed_at IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("documents", "completed_at")
