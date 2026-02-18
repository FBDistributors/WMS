"""Increase pick_requests.request_id length to 128.

Revision ID: 20260218_0037
Revises: 20260218_0036
Create Date: 2026-02-18 14:50:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "20260218_0037"
down_revision = "20260218_0036"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "pick_requests",
        "request_id",
        existing_type=sa.String(64),
        type_=sa.String(128),
        existing_nullable=False,
    )


def downgrade():
    op.alter_column(
        "pick_requests",
        "request_id",
        existing_type=sa.String(128),
        type_=sa.String(64),
        existing_nullable=False,
    )
