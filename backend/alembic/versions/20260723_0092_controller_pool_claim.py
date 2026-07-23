"""Controller pool: hujjat umumiy navbatga tushadi, controller o'zi band qiladi.

- documents.controller_claimed_at: controller navbatdan hujjatni band qilgan vaqt.
- Backfill: eski yozuvlarda `controlled_by_user_id` bor, lekin `sent_to_controller_at`
  bo'sh (0062-migratsiyagacha yaratilganlar). Endi "controllerga yuborilgan" belgisi
  `sent_to_controller_at` bo'lgani uchun ular yig'uvchi ro'yxatiga qaytib chiqmasin.

Revision ID: 20260723_0092
Revises: 20260714_0091
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260723_0092"
down_revision = "20260714_0091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("controller_claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_documents_sent_to_controller_at",
        "documents",
        ["sent_to_controller_at"],
    )
    # Eski "controllerga yuborilgan" hujjatlarga yuborilgan vaqtni tiklaymiz.
    op.execute(
        """
        UPDATE documents
           SET sent_to_controller_at = COALESCE(
                   controller_verification_started_at, updated_at, created_at
               )
         WHERE controlled_by_user_id IS NOT NULL
           AND sent_to_controller_at IS NULL
        """
    )
    # Allaqachon controllerga biriktirilganlar — band qilingan hisoblanadi.
    op.execute(
        """
        UPDATE documents
           SET controller_claimed_at = COALESCE(
                   controller_verification_started_at, sent_to_controller_at
               )
         WHERE controlled_by_user_id IS NOT NULL
           AND controller_claimed_at IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_documents_sent_to_controller_at", table_name="documents")
    op.drop_column("documents", "controller_claimed_at")
