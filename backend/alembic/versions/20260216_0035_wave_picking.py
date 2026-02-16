"""Wave picking + sorting zone tables.

Revision ID: 20260216_0035
Revises: 20260214_0034
Create Date: 2026-02-16 12:00:00.000000

"""
from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260216_0035"
down_revision = "20260214_0034"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "waves",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("wave_number", sa.String(64), nullable=False, unique=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("note", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_waves_status", "waves", ["status"])
    op.create_index("ix_waves_wave_number", "waves", ["wave_number"])
    op.create_index("ix_waves_created_by", "waves", ["created_by"])

    op.create_table(
        "wave_orders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("wave_id", UUID(as_uuid=True), sa.ForeignKey("waves.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", UUID(as_uuid=True), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("wave_id", "order_id", name="uq_wave_orders_wave_order"),
    )
    op.create_index("ix_wave_orders_wave_id", "wave_orders", ["wave_id"])
    op.create_index("ix_wave_orders_order_id", "wave_orders", ["order_id"])

    op.create_table(
        "wave_lines",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("wave_id", UUID(as_uuid=True), sa.ForeignKey("waves.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", UUID(as_uuid=True), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("barcode", sa.String(64), nullable=False),
        sa.Column("total_qty", sa.Numeric(14, 3), nullable=False),
        sa.Column("picked_qty", sa.Numeric(14, 3), nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="OPEN"),
        sa.UniqueConstraint("wave_id", "product_id", name="uq_wave_lines_wave_product"),
    )
    op.create_index("ix_wave_lines_wave_id", "wave_lines", ["wave_id"])
    op.create_index("ix_wave_lines_product_id", "wave_lines", ["product_id"])
    op.create_index("ix_wave_lines_wave_barcode", "wave_lines", ["wave_id", "barcode"])

    op.create_table(
        "wave_allocations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("wave_line_id", UUID(as_uuid=True), sa.ForeignKey("wave_lines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stock_lot_id", UUID(as_uuid=True), sa.ForeignKey("stock_lots.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("location_id", UUID(as_uuid=True), sa.ForeignKey("locations.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("allocated_qty", sa.Numeric(14, 3), nullable=False),
        sa.Column("picked_qty", sa.Numeric(14, 3), nullable=False, server_default="0"),
        sa.UniqueConstraint("wave_line_id", "stock_lot_id", "location_id", name="uq_wave_allocations_line_lot_loc"),
    )
    op.create_index("ix_wave_allocations_wave_line_id", "wave_allocations", ["wave_line_id"])
    op.create_index("ix_wave_allocations_stock_lot_id", "wave_allocations", ["stock_lot_id"])

    op.create_table(
        "sorting_bins",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("wave_id", UUID(as_uuid=True), sa.ForeignKey("waves.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", UUID(as_uuid=True), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bin_code", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="OPEN"),
        sa.UniqueConstraint("wave_id", "order_id", name="uq_sorting_bins_wave_order"),
    )
    op.create_index("ix_sorting_bins_wave_id", "sorting_bins", ["wave_id"])
    op.create_index("ix_sorting_bins_order_id", "sorting_bins", ["order_id"])

    op.create_table(
        "sorting_scans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("wave_id", UUID(as_uuid=True), sa.ForeignKey("waves.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", UUID(as_uuid=True), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("barcode", sa.String(64), nullable=False),
        sa.Column("qty", sa.Numeric(14, 3), nullable=False),
        sa.Column("scanned_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("scanned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("request_id", UUID(as_uuid=True), nullable=False, unique=True),
    )
    op.create_index("ix_sorting_scans_wave_id", "sorting_scans", ["wave_id"])
    op.create_index("ix_sorting_scans_order_id", "sorting_scans", ["order_id"])
    op.create_index("ix_sorting_scans_wave_order_barcode", "sorting_scans", ["wave_id", "order_id", "barcode"])

    op.create_table(
        "wave_pick_scans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("wave_id", UUID(as_uuid=True), sa.ForeignKey("waves.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_id", UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("barcode", sa.String(64), nullable=False),
        sa.Column("qty", sa.Numeric(14, 3), nullable=False),
        sa.Column("scanned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_wave_pick_scans_wave_id", "wave_pick_scans", ["wave_id"])

    # Create default staging/sorting location Z-SORT-01 if not exists
    conn = op.get_bind()
    r = conn.execute(sa.text("SELECT 1 FROM locations WHERE code = 'Z-SORT-01' LIMIT 1")).fetchone()
    if not r:
        conn.execute(
            sa.text("""
                INSERT INTO locations (id, code, barcode_value, name, type, location_type, is_active)
                VALUES (
                    gen_random_uuid(),
                    'Z-SORT-01',
                    'Z-SORT-01',
                    'Sorting zone',
                    'STAGING',
                    'STAGING',
                    true
                )
            """)
        )


def downgrade():
    op.drop_table("wave_pick_scans")
    op.drop_table("sorting_scans")
    op.drop_table("sorting_bins")
    op.drop_table("wave_allocations")
    op.drop_table("wave_lines")
    op.drop_table("wave_orders")
    op.drop_table("waves")
