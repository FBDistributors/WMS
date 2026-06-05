"""user_app_feedback table for mobile app internal ratings."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260604_0080"
down_revision = "20260603_0079"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_app_feedback",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("module", sa.String(length=32), nullable=False),
        sa.Column("context_ref", sa.String(length=128), nullable=True),
        sa.Column("app_version", sa.String(length=32), nullable=True),
        sa.Column("platform", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_app_feedback_user_id", "user_app_feedback", ["user_id"])
    op.create_index("ix_user_app_feedback_created_at", "user_app_feedback", ["created_at"])
    op.create_index("ix_user_app_feedback_module", "user_app_feedback", ["module"])
    op.create_index("ix_user_app_feedback_role", "user_app_feedback", ["role"])


def downgrade() -> None:
    op.drop_index("ix_user_app_feedback_role", table_name="user_app_feedback")
    op.drop_index("ix_user_app_feedback_module", table_name="user_app_feedback")
    op.drop_index("ix_user_app_feedback_created_at", table_name="user_app_feedback")
    op.drop_index("ix_user_app_feedback_user_id", table_name="user_app_feedback")
    op.drop_table("user_app_feedback")
