"""location_box_placements — yopiq quti joylashuvi.

Revision ID: 20260608_0084
Revises: 20260608_0083
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260608_0084"
down_revision = "20260608_0083"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "location_box_placements",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("product_box_id", sa.UUID(), nullable=False),
        sa.Column("location_id", sa.UUID(), nullable=False),
        sa.Column("lot_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="sealed", nullable=False),
        sa.Column(
            "placed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("placed_by_user_id", sa.UUID(), nullable=True),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("removed_by_user_id", sa.UUID(), nullable=True),
        sa.Column("remove_reason", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["lot_id"], ["stock_lots.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["placed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["product_box_id"], ["product_boxes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["removed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_location_box_placements_location_lot",
        "location_box_placements",
        ["location_id", "lot_id"],
    )
    op.create_index(
        "ix_location_box_placements_product_box_id",
        "location_box_placements",
        ["product_box_id"],
    )
    op.create_index(
        "ix_location_box_placements_status",
        "location_box_placements",
        ["status"],
    )
    op.create_index(
        "uq_location_box_placements_sealed_product_box",
        "location_box_placements",
        ["product_box_id"],
        unique=True,
        postgresql_where=sa.text("status = 'sealed'"),
        sqlite_where=sa.text("status = 'sealed'"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_location_box_placements_sealed_product_box",
        table_name="location_box_placements",
    )
    op.drop_index("ix_location_box_placements_status", table_name="location_box_placements")
    op.drop_index(
        "ix_location_box_placements_product_box_id",
        table_name="location_box_placements",
    )
    op.drop_index(
        "ix_location_box_placements_location_lot",
        table_name="location_box_placements",
    )
    op.drop_table("location_box_placements")
