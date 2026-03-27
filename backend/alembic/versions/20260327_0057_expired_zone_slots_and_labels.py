"""EXPIRED zone: expired_slot on locations + global display labels table.

Revision ID: 20260327_0057
Revises: 20260313_0056
Create Date: 2026-03-27
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260327_0057"
down_revision = "20260313_0056"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "expired_zone_display_labels",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("label_for_slot_a", sa.Integer(), nullable=True),
        sa.Column("label_for_slot_b", sa.Integer(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_expired_zone_display_labels"),
        sa.CheckConstraint("id = 1", name="ck_expired_zone_display_labels_singleton"),
    )
    op.execute(
        sa.text(
            "INSERT INTO expired_zone_display_labels (id, label_for_slot_a, label_for_slot_b) "
            "VALUES (1, 6, 7)"
        )
    )

    op.add_column("locations", sa.Column("expired_slot", sa.String(1), nullable=True))
    op.create_check_constraint(
        "ck_locations_expired_slot",
        "locations",
        "expired_slot IS NULL OR expired_slot IN ('A', 'B')",
    )
    op.create_check_constraint(
        "ck_locations_expired_slot_zone",
        "locations",
        "expired_slot IS NULL OR zone_type = 'EXPIRED'",
    )


def downgrade():
    op.drop_constraint("ck_locations_expired_slot_zone", "locations", type_="check")
    op.drop_constraint("ck_locations_expired_slot", "locations", type_="check")
    op.drop_column("locations", "expired_slot")
    op.drop_table("expired_zone_display_labels")
