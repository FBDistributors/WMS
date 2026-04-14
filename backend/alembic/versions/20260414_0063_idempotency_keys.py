"""Add idempotency_keys table for mutation dedupe.

Revision ID: 20260414_0063
Revises: 20260404_0062
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260414_0063"
down_revision = "20260404_0062"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "idempotency_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("scope", sa.String(length=64), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=False),
        sa.Column("response_body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_idempotency_scope_user_key", "idempotency_keys", ["scope", "user_id", "key"], unique=True)
    op.create_index("ix_idempotency_expires_at", "idempotency_keys", ["expires_at"], unique=False)


def downgrade():
    op.drop_index("ix_idempotency_expires_at", table_name="idempotency_keys")
    op.drop_index("uq_idempotency_scope_user_key", table_name="idempotency_keys")
    op.drop_table("idempotency_keys")
