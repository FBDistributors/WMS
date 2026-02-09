"""Add warehouse locations hierarchy.

Revision ID: 20260209_0011
Revises: 20260209_0010
Create Date: 2026-02-09 14:05:00.000000
"""
from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260209_0011"
down_revision = "20260209_0010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "locations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("locations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_index("ix_locations_parent_id", "locations", ["parent_id"])
    op.create_index("ix_locations_type", "locations", ["type"])
    op.create_index("ix_locations_is_active", "locations", ["is_active"])

    zone_a = uuid.uuid4()
    rack_a1 = uuid.uuid4()
    shelf_a1_1 = uuid.uuid4()
    bin_a1_1_1 = uuid.uuid4()
    bin_a1_1_2 = uuid.uuid4()
    zone_b = uuid.uuid4()
    rack_b1 = uuid.uuid4()
    shelf_b1_1 = uuid.uuid4()
    bin_b1_1_1 = uuid.uuid4()

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO locations (id, code, name, type, parent_id, is_active)
            VALUES
              (:zone_a, 'Z-A', 'Zone A', 'zone', NULL, true),
              (:rack_a1, 'R-A1', 'Rack A1', 'rack', :zone_a, true),
              (:shelf_a1_1, 'S-A1-1', 'Shelf A1-1', 'shelf', :rack_a1, true),
              (:bin_a1_1_1, 'B-A1-1-1', 'Bin A1-1-1', 'bin', :shelf_a1_1, true),
              (:bin_a1_1_2, 'B-A1-1-2', 'Bin A1-1-2', 'bin', :shelf_a1_1, true),
              (:zone_b, 'Z-B', 'Zone B', 'zone', NULL, true),
              (:rack_b1, 'R-B1', 'Rack B1', 'rack', :zone_b, true),
              (:shelf_b1_1, 'S-B1-1', 'Shelf B1-1', 'shelf', :rack_b1, true),
              (:bin_b1_1_1, 'B-B1-1-1', 'Bin B1-1-1', 'bin', :shelf_b1_1, true)
            """
        ),
        {
            "zone_a": zone_a,
            "rack_a1": rack_a1,
            "shelf_a1_1": shelf_a1_1,
            "bin_a1_1_1": bin_a1_1_1,
            "bin_a1_1_2": bin_a1_1_2,
            "zone_b": zone_b,
            "rack_b1": rack_b1,
            "shelf_b1_1": shelf_b1_1,
            "bin_b1_1_1": bin_b1_1_1,
        },
    )


def downgrade():
    op.drop_index("ix_locations_is_active", table_name="locations")
    op.drop_index("ix_locations_type", table_name="locations")
    op.drop_index("ix_locations_parent_id", table_name="locations")
    op.drop_table("locations")
