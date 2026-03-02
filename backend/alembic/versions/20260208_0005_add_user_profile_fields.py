"""Add user profile fields.

Revision ID: 20260208_0005
Revises: 20260208_0004
Create Date: 2026-02-08 01:30:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "20260208_0005"
down_revision = "20260208_0004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("full_name", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_full_name", "users", ["full_name"])


def downgrade():
    op.drop_index("ix_users_full_name", table_name="users")
    op.drop_column("users", "last_login_at")
    op.drop_column("users", "full_name")
