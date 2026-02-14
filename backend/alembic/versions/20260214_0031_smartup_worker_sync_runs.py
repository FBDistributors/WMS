"""Add worker sync columns to smartup_sync_runs.

Revision ID: 20260214_0031
Revises: 20260212_0030
Create Date: 2026-02-14

"""
from alembic import op
import sqlalchemy as sa


revision = "20260214_0031"
down_revision = "20260212_0030"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "smartup_sync_runs",
        sa.Column("synced_products_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "smartup_sync_runs",
        sa.Column("synced_orders_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "smartup_sync_runs",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_smartup_sync_runs_started_at",
        "smartup_sync_runs",
        ["started_at"],
    )


def downgrade():
    op.drop_index("ix_smartup_sync_runs_started_at", table_name="smartup_sync_runs")
    op.drop_column("smartup_sync_runs", "created_at")
    op.drop_column("smartup_sync_runs", "synced_orders_count")
    op.drop_column("smartup_sync_runs", "synced_products_count")
