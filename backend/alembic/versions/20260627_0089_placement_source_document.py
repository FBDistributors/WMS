"""location_box_placements.source_document_id — qaysi SO hujjat uchun olib/ochildi.

Unpick/skip/cancel'da butun-quti pick (reason='pick') yozuvlarini aynan shu
hujjat bo'yicha qaytarish (sealed-restore) uchun kerak.

Revision ID: 20260627_0089
Revises: 20260622_0088
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260627_0089"
down_revision = "20260622_0088"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "location_box_placements",
        sa.Column("source_document_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_location_box_placements_source_document",
        "location_box_placements",
        "documents",
        ["source_document_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_location_box_placements_source_document_id",
        "location_box_placements",
        ["source_document_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_location_box_placements_source_document_id",
        table_name="location_box_placements",
    )
    op.drop_constraint(
        "fk_location_box_placements_source_document",
        "location_box_placements",
        type_="foreignkey",
    )
    op.drop_column("location_box_placements", "source_document_id")
