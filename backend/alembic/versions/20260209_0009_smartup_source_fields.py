"""Add Smartup source fields to documents.

Revision ID: 20260209_0009
Revises: 20260209_0008
Create Date: 2026-02-09 12:20:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260209_0009"
down_revision = "20260209_0008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("documents", sa.Column("source_document_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("documents", sa.Column("source_customer_name", sa.String(length=255), nullable=True))
    op.add_column("documents", sa.Column("source_filial_id", sa.String(length=64), nullable=True))


def downgrade():
    op.drop_column("documents", "source_filial_id")
    op.drop_column("documents", "source_customer_name")
    op.drop_column("documents", "source_document_date")
