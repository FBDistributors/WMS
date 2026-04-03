"""documents.sent_to_controller_at — yig'uvchi controllerga yuborgan vaqt.

Revision ID: 20260404_0062
Revises: 20260403_0061
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260404_0062"
down_revision = "20260403_0061"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "documents",
        sa.Column("sent_to_controller_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("documents", "sent_to_controller_at")
