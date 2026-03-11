"""Add indexes for load test optimization (orders, documents).

Revision ID: 20260311_0053
Revises: 20260311_0052
Create Date: 2026-03-11

"""
from __future__ import annotations

from alembic import op

revision = "20260311_0053"
down_revision = "20260311_0052"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_documents_order_id ON documents (order_id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_doc_type_status ON documents (doc_type, status)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_orders_created_at")
    op.execute("DROP INDEX IF EXISTS idx_documents_order_id")
    op.execute("DROP INDEX IF EXISTS idx_documents_doc_type_status")
