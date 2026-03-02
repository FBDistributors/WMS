"""Extend smartup sync runs for products.

Revision ID: 20260210_0019
Revises: 20260210_0018
Create Date: 2026-02-10 10:05:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260210_0019"
down_revision = "20260210_0018"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "smartup_sync_runs",
        sa.Column("run_type", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "smartup_sync_runs",
        sa.Column("request_payload", postgresql.JSONB, nullable=True),
    )
    op.add_column(
        "smartup_sync_runs",
        sa.Column("inserted_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "smartup_sync_runs",
        sa.Column("updated_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "smartup_sync_runs",
        sa.Column("skipped_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "smartup_sync_runs",
        sa.Column("status", sa.String(length=16), nullable=False, server_default="success"),
    )
    op.add_column(
        "smartup_sync_runs",
        sa.Column("error_message", sa.String(length=512), nullable=True),
    )

    op.execute("UPDATE smartup_sync_runs SET run_type = 'orders' WHERE run_type IS NULL")
    op.alter_column("smartup_sync_runs", "run_type", nullable=False)
    op.create_index("ix_smartup_sync_runs_run_type", "smartup_sync_runs", ["run_type"])


def downgrade():
    op.drop_index("ix_smartup_sync_runs_run_type", table_name="smartup_sync_runs")
    op.drop_column("smartup_sync_runs", "error_message")
    op.drop_column("smartup_sync_runs", "status")
    op.drop_column("smartup_sync_runs", "skipped_count")
    op.drop_column("smartup_sync_runs", "updated_count")
    op.drop_column("smartup_sync_runs", "inserted_count")
    op.drop_column("smartup_sync_runs", "request_payload")
    op.drop_column("smartup_sync_runs", "run_type")
