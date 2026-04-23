"""Safe cancel during picking: return-to-bin session + lines.

Revision ID: 20260423_0068
Revises: 20260423_0067
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260423_0068"
down_revision = "20260423_0067"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "safe_cancel_return_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("picker_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("initiated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="returns_pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["initiated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["picker_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_safe_cancel_return_sessions_document_id",
        "safe_cancel_return_sessions",
        ["document_id"],
    )
    op.create_index(
        "ix_safe_cancel_return_sessions_picker_user_id",
        "safe_cancel_return_sessions",
        ["picker_user_id"],
    )
    op.create_index(
        "ix_safe_cancel_return_sessions_status",
        "safe_cancel_return_sessions",
        ["status"],
    )

    op.create_table(
        "safe_cancel_return_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("document_line_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("expected_location_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("expected_location_code", sa.String(64), nullable=False, server_default=""),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_name", sa.String(512), nullable=False),
        sa.Column("barcode", sa.String(64), nullable=True),
        sa.Column("sku", sa.String(64), nullable=True),
        sa.Column("qty_to_return", sa.Numeric(18, 3), nullable=False),
        sa.Column("location_confirmed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("product_confirmed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.ForeignKeyConstraint(["document_line_id"], ["document_lines.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["expected_location_id"], ["locations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["lot_id"], ["stock_lots.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["session_id"], ["safe_cancel_return_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_safe_cancel_return_lines_session_id",
        "safe_cancel_return_lines",
        ["session_id"],
    )
    op.create_index(
        "ix_safe_cancel_return_lines_document_line_id",
        "safe_cancel_return_lines",
        ["document_line_id"],
    )


def downgrade():
    op.drop_table("safe_cancel_return_lines")
    op.drop_table("safe_cancel_return_sessions")
