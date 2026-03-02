"""Increase products name/short_name/brand length for SmartUp long names.

Revision ID: 20260214_0032
Revises: 20260214_0031
Create Date: 2026-02-14

"""
from alembic import op
import sqlalchemy as sa


revision = "20260214_0032"
down_revision = "20260214_0031"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "products",
        "name",
        existing_type=sa.String(128),
        type_=sa.String(512),
        existing_nullable=False,
    )
    op.alter_column(
        "products",
        "short_name",
        existing_type=sa.String(128),
        type_=sa.String(512),
        existing_nullable=True,
    )
    op.alter_column(
        "products",
        "brand",
        existing_type=sa.String(128),
        type_=sa.String(256),
        existing_nullable=True,
    )


def downgrade():
    op.alter_column(
        "products",
        "name",
        existing_type=sa.String(512),
        type_=sa.String(128),
        existing_nullable=False,
    )
    op.alter_column(
        "products",
        "short_name",
        existing_type=sa.String(512),
        type_=sa.String(128),
        existing_nullable=True,
    )
    op.alter_column(
        "products",
        "brand",
        existing_type=sa.String(256),
        type_=sa.String(128),
        existing_nullable=True,
    )
