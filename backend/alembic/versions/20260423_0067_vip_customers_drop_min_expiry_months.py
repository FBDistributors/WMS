"""VIP: backfill brand limits from legacy min_expiry_months, drop column.

Revision ID: 20260423_0067
Revises: 20260421_0066
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260423_0067"
down_revision = "20260421_0066"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        sa.text(
            """
            INSERT INTO vip_customer_brand_limits (id, vip_customer_id, brand_id, min_expiry_months)
            SELECT gen_random_uuid(), vc.id, b.id, vc.min_expiry_months
            FROM vip_customers vc
            CROSS JOIN brands b
            WHERE b.is_active IS TRUE
            AND NOT EXISTS (
                SELECT 1
                FROM vip_customer_brand_limits vbl
                WHERE vbl.vip_customer_id = vc.id
                  AND vbl.brand_id = b.id
            )
            """
        )
    )
    op.drop_column("vip_customers", "min_expiry_months")


def downgrade():
    op.add_column(
        "vip_customers",
        sa.Column("min_expiry_months", sa.Integer(), nullable=False, server_default="19"),
    )
    op.execute(sa.text("ALTER TABLE vip_customers ALTER COLUMN min_expiry_months DROP DEFAULT"))
