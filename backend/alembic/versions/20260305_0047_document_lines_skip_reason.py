"""Add skip_reason to document_lines (pozitsiyada sabab bildirish).

Revision ID: 20260305_0047
Revises: 20260305_0046
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa

revision = "20260305_0047"
down_revision = "20260305_0046"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "document_lines",
        sa.Column("skip_reason", sa.String(64), nullable=True),
    )


def downgrade():
    op.drop_column("document_lines", "skip_reason")
