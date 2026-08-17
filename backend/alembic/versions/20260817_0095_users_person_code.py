"""users.person_code: bitta jismoniy xodimning profillarini bog'lash.

"To'rt ko'z" qoidasi uchun asos: yig'uvchi va controller sifatida ikki alohida
profil bilan ishlaydigan xodimning profillari bir xil person_code oladi (admin
kiritadi). Kod bo'sh bo'lsa hech qanday cheklov ishlamaydi — xavfsiz rollout.

Revision ID: 20260817_0095
Revises: 20260808_0094
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260817_0095"
down_revision = "20260808_0094"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("person_code", sa.String(length=64), nullable=True))
    op.create_index("ix_users_person_code", "users", ["person_code"])


def downgrade() -> None:
    op.drop_index("ix_users_person_code", table_name="users")
    op.drop_column("users", "person_code")
