"""Bir xil quti turidan ko'p sealed placement — unique cheklovni olib tashlash.

Revision ID: 20260609_0087
Revises: 20260608_0086
"""
from __future__ import annotations

from alembic import op

revision = "20260609_0087"
down_revision = "20260608_0086"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 0084 dagi xato: product_box_id bo'yicha faqat 1 ta sealed qator.
    # Bir xil quti turi (masalan 5 ta quti × 6 dona) ko'p marta joylashishi kerak.
    op.drop_index(
        "uq_location_box_placements_sealed_product_box",
        table_name="location_box_placements",
        if_exists=True,
    )


def downgrade() -> None:
    op.create_index(
        "uq_location_box_placements_sealed_product_box",
        "location_box_placements",
        ["product_box_id"],
        unique=True,
        postgresql_where="status = 'sealed'",
    )
