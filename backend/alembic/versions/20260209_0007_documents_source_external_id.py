"""Add documents source_external_id.

Revision ID: 20260209_0007
Revises: 20260209_0006
Create Date: 2026-02-09 11:10:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260209_0007"
down_revision = "20260209_0006"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("documents", sa.Column("source_external_id", sa.String(length=128), nullable=True))
    op.create_index("ix_documents_source_external_id", "documents", ["source_external_id"])
    op.create_unique_constraint(
        "uq_documents_source_external_id_doc_type",
        "documents",
        ["source_external_id", "doc_type"],
    )


def downgrade():
    op.drop_constraint("uq_documents_source_external_id_doc_type", "documents", type_="unique")
    op.drop_index("ix_documents_source_external_id", table_name="documents")
    op.drop_column("documents", "source_external_id")
