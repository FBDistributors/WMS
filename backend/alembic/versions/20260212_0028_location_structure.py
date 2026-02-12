"""Location structure: location_type (RACK/FLOOR), sector, level, row_no, pallet_no, created_at.

Revision ID: 20260212_0028
Revises: 20260211_0027
Create Date: 2026-02-12

"""
from alembic import op
import sqlalchemy as sa

revision = "20260212_0028"
down_revision = "20260211_0027"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "locations",
        sa.Column("location_type", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "locations",
        sa.Column("sector", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "locations",
        sa.Column("level", sa.Integer(), nullable=True),
    )
    op.add_column(
        "locations",
        sa.Column("row_no", sa.Integer(), nullable=True),
    )
    op.add_column(
        "locations",
        sa.Column("pallet_no", sa.Integer(), nullable=True),
    )
    op.add_column(
        "locations",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_locations_sector", "locations", ["sector"])
    op.create_index("ix_locations_location_type", "locations", ["location_type"])


def downgrade():
    op.drop_index("ix_locations_location_type", table_name="locations")
    op.drop_index("ix_locations_sector", table_name="locations")
    op.drop_column("locations", "created_at")
    op.drop_column("locations", "pallet_no")
    op.drop_column("locations", "row_no")
    op.drop_column("locations", "level")
    op.drop_column("locations", "sector")
    op.drop_column("locations", "location_type")
