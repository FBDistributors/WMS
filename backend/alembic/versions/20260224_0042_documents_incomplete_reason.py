"""Add incomplete_reason to documents (picker to'liq yig'maganda sabab).

Revision ID: 20260224_0042
Revises: 20260222_0041
Create Date: 2026-02-24

"""
from alembic import op
import sqlalchemy as sa

revision = "20260224_0042"
down_revision = "20260222_0041"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "documents",
        sa.Column("incomplete_reason", sa.String(64), nullable=True),
    )


def downgrade():
    op.drop_column("documents", "incomplete_reason")
