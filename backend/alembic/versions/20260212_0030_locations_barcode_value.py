"""Add barcode_value to locations (unique, same as code for new rows).

Revision ID: 20260212_0030
Revises: 20260212_0029
Create Date: 2026-02-12

"""
from alembic import op
import sqlalchemy as sa

revision = "20260212_0030"
down_revision = "20260212_0029"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "locations",
        sa.Column("barcode_value", sa.String(length=64), nullable=True),
    )
    # Backfill: barcode_value = code for existing rows
    op.execute("UPDATE locations SET barcode_value = code WHERE barcode_value IS NULL")
    op.alter_column(
        "locations",
        "barcode_value",
        existing_type=sa.String(64),
        nullable=False,
    )
    op.create_index("ix_locations_barcode_value", "locations", ["barcode_value"], unique=True)


def downgrade():
    op.drop_index("ix_locations_barcode_value", table_name="locations")
    op.drop_column("locations", "barcode_value")
