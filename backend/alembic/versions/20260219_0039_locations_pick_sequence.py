"""Add pick_sequence to locations (terish ketma-ketligi).

Revision ID: 20260219_0039
Revises: 20260218_0038
Create Date: 2026-02-19

"""
from alembic import op
import sqlalchemy as sa

revision = "20260219_0039"
down_revision = "20260218_0038"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "locations",
        sa.Column("pick_sequence", sa.Integer(), nullable=True),
    )
    op.create_index("ix_locations_pick_sequence", "locations", ["pick_sequence"])


def downgrade():
    op.drop_index("ix_locations_pick_sequence", table_name="locations")
    op.drop_column("locations", "pick_sequence")
