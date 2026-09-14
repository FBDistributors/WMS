"""Diller sanovi — qatorga kiritishlar tarixi (qayta skanda qo'shish).

Har kiritish alohida yozuv: `set` (jami), `add` (ustiga qo'shildi), `clear` (web'da bo'shatildi).
`id` — telefon beradigan `op_id`, takror yuborilgan kiritish ikki marta qo'llanmasin.
Mavjud sanalgan qatorlar bittadan `set` yozuvi bilan to'ldiriladi.

Revision ID: 20260914_0102
Revises: 20260914_0101
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260914_0102"
down_revision = "20260914_0101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dealer_stock_count_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "line_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dealer_stock_count_lines.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("qty", sa.Numeric(12, 3), nullable=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("counted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('set', 'add', 'clear')", name="ck_dealer_stock_count_entries_kind"),
    )
    op.create_index("ix_dealer_stock_count_entries_line_id", "dealer_stock_count_entries", ["line_id"])
    op.execute(
        "INSERT INTO dealer_stock_count_entries (id, line_id, kind, qty, user_id, counted_at) "
        "SELECT gen_random_uuid(), l.id, 'set', l.qty, l.counted_by_user_id, l.counted_at "
        "FROM dealer_stock_count_lines l WHERE l.qty IS NOT NULL AND l.counted_at IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_dealer_stock_count_entries_line_id", table_name="dealer_stock_count_entries")
    op.drop_table("dealer_stock_count_entries")
