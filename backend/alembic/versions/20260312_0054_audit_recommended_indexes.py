"""Add indexes from PostgreSQL Index Audit Report (POSTGRESQL_INDEX_AUDIT_REPORT.md).

Revision ID: 20260312_0054
Revises: 20260311_0053
Create Date: 2026-03-12

Birinchi navbatda qo'shiladigan 5 ta index:
1. documents (doc_type, status, updated_at DESC) — dashboard pick-documents filter + sort
2. documents (assigned_to_user_id, created_at DESC) — picking list (picker)
3. document_lines (document_id, expiry_date) — FEFO / consolidated view
4. user_sessions (user_id, token) — auth session lookup
5. orders (delivery_date) — list_orders sana filter
"""
from __future__ import annotations

from alembic import op

revision = "20260312_0054"
down_revision = "20260311_0053"
branch_labels = None
depends_on = None


def upgrade():
    # 1. documents: filter (doc_type, status) + sort updated_at DESC
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_doc_type_status_updated_at "
        "ON documents (doc_type, status, updated_at DESC)"
    )
    # 2. documents: picker list by assigned_to_user_id, sort created_at DESC
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_assigned_created_at "
        "ON documents (assigned_to_user_id, created_at DESC)"
    )
    # 3. document_lines: FEFO order by expiry_date within document
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_document_lines_document_expiry "
        "ON document_lines (document_id, expiry_date NULLS LAST)"
    )
    # 4. user_sessions: exact lookup (user_id, token) on every request
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_sessions_user_token "
        "ON user_sessions (user_id, token)"
    )
    # 5. orders: delivery_date range filter (list_orders date_from/date_to)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_orders_delivery_date ON orders (delivery_date)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_orders_delivery_date")
    op.execute("DROP INDEX IF EXISTS idx_user_sessions_user_token")
    op.execute("DROP INDEX IF EXISTS idx_document_lines_document_expiry")
    op.execute("DROP INDEX IF EXISTS idx_documents_assigned_created_at")
    op.execute("DROP INDEX IF EXISTS idx_documents_doc_type_status_updated_at")
