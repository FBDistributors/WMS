"""Add session tracking fields for single-device login

Revision ID: 20260211_0027
Revises: 20260211_0026
Create Date: 2026-02-11 17:45:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "20260211_0027"
down_revision = "20260211_0026"
branch_labels = None
depends_on = None


def upgrade():
    # Add session tracking fields
    op.add_column(
        "users",
        sa.Column("active_session_token", sa.String(length=512), nullable=True)
    )
    op.add_column(
        "users",
        sa.Column("last_device_info", sa.String(length=512), nullable=True)
    )
    op.add_column(
        "users",
        sa.Column("session_started_at", sa.DateTime(timezone=True), nullable=True)
    )
    
    # Add index for fast session lookup
    op.create_index(
        "ix_users_active_session",
        "users",
        ["active_session_token"],
        unique=False,
        postgresql_where=sa.text("active_session_token IS NOT NULL")
    )


def downgrade():
    op.drop_index("ix_users_active_session", table_name="users")
    op.drop_column("users", "session_started_at")
    op.drop_column("users", "last_device_info")
    op.drop_column("users", "active_session_token")
