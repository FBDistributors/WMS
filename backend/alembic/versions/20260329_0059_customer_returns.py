"""Customer returns (mijozdan qaytgan): controller -> picker putaway.

Revision ID: 20260329_0059
Revises: 20260328_0058
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260329_0059"
down_revision = "20260328_0058"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "customer_returns",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("doc_no", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending_controller"),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("assigned_picker_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assigned_picker_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("doc_no", name="uq_customer_returns_doc_no"),
    )
    op.create_index("ix_customer_returns_status", "customer_returns", ["status"])
    op.create_index("ix_customer_returns_created_at", "customer_returns", ["created_at"])
    op.create_index(
        "ix_customer_returns_assigned_picker_user_id",
        "customer_returns",
        ["assigned_picker_user_id"],
    )

    op.create_table(
        "customer_return_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_return_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_name", sa.String(512), nullable=False),
        sa.Column("location_code", sa.String(64), nullable=False, server_default=""),
        sa.Column("qty", sa.Numeric(14, 3), nullable=False),
        sa.Column("batch", sa.String(64), nullable=False, server_default=""),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["customer_return_id"], ["customer_returns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_customer_return_lines_return_id",
        "customer_return_lines",
        ["customer_return_id"],
    )
    op.create_index(
        "ix_customer_return_lines_product_id",
        "customer_return_lines",
        ["product_id"],
    )


def downgrade():
    op.drop_table("customer_return_lines")
    op.drop_table("customer_returns")
