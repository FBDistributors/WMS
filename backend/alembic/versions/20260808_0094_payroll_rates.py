"""payroll_rates: bitta buyurtma uchun to'lov (rol + manba guruhi).

Boshlang'ich qiymatlar amaldagi tariflardan olindi va uzoq o'tmish sanasi bilan
yoziladi — eski davrlar ham tarifsiz qolmasin. Keyingi o'zgarishlar yangi qator
bo'lib qo'shiladi, ya'ni to'langan oy o'z tarifida qoladi.

Revision ID: 20260808_0094
Revises: 20260728_0093
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260808_0094"
down_revision = "20260728_0093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payroll_rates",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("source_group", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_by_user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint(
            "role", "source_group", "effective_from", name="uq_payroll_rates_role_group_from"
        ),
    )
    op.execute(
        """
        INSERT INTO payroll_rates (id, role, source_group, amount, effective_from)
        VALUES
            (gen_random_uuid(), 'picker', 'shahar', 463, DATE '2020-01-01'),
            (gen_random_uuid(), 'picker', 'region', 1389, DATE '2020-01-01'),
            (gen_random_uuid(), 'controller', 'shahar', 278, DATE '2020-01-01'),
            (gen_random_uuid(), 'controller', 'region', 834, DATE '2020-01-01')
        """
    )


def downgrade() -> None:
    op.drop_table("payroll_rates")
