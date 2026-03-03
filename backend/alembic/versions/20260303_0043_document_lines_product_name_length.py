"""Increase document_lines.product_name length (128 -> 512) for long Smartup names.

Revision ID: 20260303_0043
Revises: 20260224_0042
Create Date: 2026-03-03

"""
from alembic import op
import sqlalchemy as sa

revision = "20260303_0043"
down_revision = "20260224_0042"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "document_lines",
        "product_name",
        existing_type=sa.String(128),
        type_=sa.String(512),
        existing_nullable=False,
    )


def downgrade():
    op.alter_column(
        "document_lines",
        "product_name",
        existing_type=sa.String(512),
        type_=sa.String(128),
        existing_nullable=False,
    )
