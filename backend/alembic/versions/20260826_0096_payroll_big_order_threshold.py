"""payroll_big_order_thresholds: yirik buyurtma chegarasi (admin o'zgartiradi).

Ro'yxatdagi mijoz (hozircha UZUM MARKET) buyurtmasi chegaradan ORTIQ bo'lsa —
region tarifi. Chegara sanali: o'zgarish yangi qator, o'tgan davrlar qayta
hisoblanmaydi (payroll_rates printsipi).

Revision ID: 20260826_0096
Revises: 20260817_0095
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260826_0096"
down_revision = "20260817_0095"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payroll_big_order_thresholds",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False, unique=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_by_user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("payroll_big_order_thresholds")
