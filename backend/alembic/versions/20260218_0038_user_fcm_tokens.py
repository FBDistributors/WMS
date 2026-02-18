"""User FCM tokens for push notifications.

Revision ID: 20260218_0038
Revises: 20260218_0037
Create Date: 2026-02-18

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260218_0038"
down_revision = "20260218_0037"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_fcm_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String(length=512), nullable=False),
        sa.Column("device_id", sa.String(length=256), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_fcm_tokens_user_id", "user_fcm_tokens", ["user_id"])
    op.create_index("ix_user_fcm_tokens_token", "user_fcm_tokens", ["token"], unique=True)


def downgrade():
    op.drop_index("ix_user_fcm_tokens_token", table_name="user_fcm_tokens")
    op.drop_index("ix_user_fcm_tokens_user_id", table_name="user_fcm_tokens")
    op.drop_table("user_fcm_tokens")
