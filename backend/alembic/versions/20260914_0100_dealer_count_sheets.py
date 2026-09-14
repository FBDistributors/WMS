"""Diller sanovi — tayyor ro'yxat (ведомость) rejimi.

Qator `qty` NULL bo'lishi mumkin (sanalmagan), Smartup snapshot, kim/qachon sanadi;
hujjatda `in_progress` holati (telefon oldi → web qulf), kim oldi, manba, yuborish rejimi.

Revision ID: 20260914_0100
Revises: 20260911_0099
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260914_0100"
down_revision = "20260911_0099"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- qatorlar ---
    op.drop_constraint("ck_dealer_stock_count_lines_qty_positive", "dealer_stock_count_lines", type_="check")
    op.alter_column("dealer_stock_count_lines", "qty", existing_type=sa.Numeric(12, 3), nullable=True)
    op.create_check_constraint(
        "ck_dealer_stock_count_lines_qty_nonneg", "dealer_stock_count_lines", "qty IS NULL OR qty >= 0"
    )
    op.add_column("dealer_stock_count_lines", sa.Column("snapshot_qty", sa.Numeric(12, 3), nullable=True))
    op.add_column("dealer_stock_count_lines", sa.Column("counted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "dealer_stock_count_lines",
        sa.Column(
            "counted_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Mavjud qatorlar hammasi sanalgan: counted_at = scanned_at (yoki hujjat vaqti).
    op.execute(
        "UPDATE dealer_stock_count_lines l SET counted_at = COALESCE(l.scanned_at, c.started_at), "
        "counted_by_user_id = c.counted_by_user_id "
        "FROM dealer_stock_counts c WHERE c.id = l.count_id AND l.counted_at IS NULL"
    )

    # --- hujjat ---
    op.drop_constraint("ck_dealer_stock_counts_status", "dealer_stock_counts", type_="check")
    op.create_check_constraint(
        "ck_dealer_stock_counts_status", "dealer_stock_counts", "status IN ('draft', 'in_progress', 'submitted')"
    )
    op.add_column(
        "dealer_stock_counts", sa.Column("source", sa.String(length=16), nullable=False, server_default="mobile")
    )
    op.add_column(
        "dealer_stock_counts",
        sa.Column(
            "assigned_to_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("dealer_stock_counts", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("dealer_stock_counts", sa.Column("uncounted_policy", sa.String(length=8), nullable=True))


def downgrade() -> None:
    op.drop_column("dealer_stock_counts", "uncounted_policy")
    op.drop_column("dealer_stock_counts", "claimed_at")
    op.drop_column("dealer_stock_counts", "assigned_to_user_id")
    op.drop_column("dealer_stock_counts", "source")
    op.drop_constraint("ck_dealer_stock_counts_status", "dealer_stock_counts", type_="check")
    op.create_check_constraint(
        "ck_dealer_stock_counts_status", "dealer_stock_counts", "status IN ('draft', 'submitted')"
    )
    op.drop_column("dealer_stock_count_lines", "counted_by_user_id")
    op.drop_column("dealer_stock_count_lines", "counted_at")
    op.drop_column("dealer_stock_count_lines", "snapshot_qty")
    op.execute("DELETE FROM dealer_stock_count_lines WHERE qty IS NULL OR qty <= 0")
    op.drop_constraint("ck_dealer_stock_count_lines_qty_nonneg", "dealer_stock_count_lines", type_="check")
    op.alter_column("dealer_stock_count_lines", "qty", existing_type=sa.Numeric(12, 3), nullable=False)
    op.create_check_constraint("ck_dealer_stock_count_lines_qty_positive", "dealer_stock_count_lines", "qty > 0")
