"""Add code to users (qisqa raqam 001, 002).

Revision ID: 20260308_0049
Revises: 20260307_0048
Create Date: 2026-03-08

"""
from alembic import op
import sqlalchemy as sa

revision = "20260308_0049"
down_revision = "20260307_0048"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("code", sa.String(length=32), nullable=True))
    op.create_index("ix_users_code", "users", ["code"])
    op.create_unique_constraint("uq_users_code", "users", ["code"])


def downgrade():
    op.drop_constraint("uq_users_code", "users", type_="unique")
    op.drop_index("ix_users_code", table_name="users")
    op.drop_column("users", "code")
