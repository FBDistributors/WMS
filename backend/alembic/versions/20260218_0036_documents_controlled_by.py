"""Add controlled_by_user_id to documents for controller flow.

Revision ID: 20260218_0036
Revises: 20260216_0035
Create Date: 2026-02-18 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260218_0036"
down_revision = "20260216_0035"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "documents",
        sa.Column("controlled_by_user_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_documents_controlled_by_user_id",
        "documents",
        "users",
        ["controlled_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_documents_controlled_by_user_id",
        "documents",
        ["controlled_by_user_id"],
    )


def downgrade():
    op.drop_index("ix_documents_controlled_by_user_id", table_name="documents")
    op.drop_constraint("fk_documents_controlled_by_user_id", "documents", type_="foreignkey")
    op.drop_column("documents", "controlled_by_user_id")
