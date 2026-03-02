"""Add zone_type to locations, reason_code to stock_movements.

Revision ID: 20260222_0040
Revises: 20260219_0039
Create Date: 2026-02-22

Zone types: NORMAL, EXPIRED, DAMAGED, QUARANTINE.
NOTE: movement_type CHECK is NOT changed here so existing allocate/unallocate
rows on Render (and other envs) do not violate the constraint. App validates
new movements via ON_HAND_MOVEMENT_TYPES. When all envs have no allocate/
unallocate rows, add a separate migration to tighten the CHECK.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260222_0040"
down_revision = "20260219_0039"
branch_labels = None
depends_on = None

ZONE_TYPES = ("NORMAL", "EXPIRED", "DAMAGED", "QUARANTINE")


def upgrade():
    # --- locations: zone_type ---
    op.add_column(
        "locations",
        sa.Column("zone_type", sa.String(32), nullable=True),
    )
    op.execute("UPDATE locations SET zone_type = 'NORMAL' WHERE zone_type IS NULL")
    op.alter_column(
        "locations",
        "zone_type",
        nullable=False,
        server_default="NORMAL",
    )
    op.create_check_constraint(
        "ck_locations_zone_type",
        "locations",
        f"zone_type IN {ZONE_TYPES}",
    )
    op.create_index("ix_locations_zone_type", "locations", ["zone_type"])

    # --- locations: warehouse_id (optional, for per-warehouse zone constraint) ---
    op.add_column(
        "locations",
        sa.Column("warehouse_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_locations_warehouse_id",
        "locations",
        "locations",
        ["warehouse_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_locations_warehouse_id", "locations", ["warehouse_id"])

    # --- stock_movements: reason_code ---
    op.add_column(
        "stock_movements",
        sa.Column("reason_code", sa.String(64), nullable=True),
    )
    op.create_index("ix_stock_movements_reason_code", "stock_movements", ["reason_code"])

    # movement_type CHECK left unchanged: existing allocate/unallocate rows must remain valid


def downgrade():
    op.drop_index("ix_stock_movements_reason_code", table_name="stock_movements")
    op.drop_column("stock_movements", "reason_code")
    op.drop_index("ix_locations_warehouse_id", table_name="locations")
    op.drop_constraint("fk_locations_warehouse_id", "locations", type_="foreignkey")
    op.drop_column("locations", "warehouse_id")
    op.drop_index("ix_locations_zone_type", table_name="locations")
    op.drop_constraint("ck_locations_zone_type", "locations", type_="check")
    op.drop_column("locations", "zone_type")
