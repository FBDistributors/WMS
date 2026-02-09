"""Add documents source and smartup sync runs.

Revision ID: 20260209_0008
Revises: 20260209_0007
Create Date: 2026-02-09 12:05:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260209_0008"
down_revision = "20260209_0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("documents", sa.Column("source", sa.String(length=32), nullable=True))
    op.create_index("ix_documents_source", "documents", ["source"])

    op.create_table(
        "smartup_sync_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("params_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("success_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("errors_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="smartup"),
    )


def downgrade():
    op.drop_table("smartup_sync_runs")
    op.drop_index("ix_documents_source", table_name="documents")
    op.drop_column("documents", "source")
