"""Backfill user code: code IS NULL bo'lgan barcha userlarga 001, 002, ... yozish.

Revision ID: 20260308_0051
Revises: 20260308_0050
Create Date: 2026-03-08

"""
from alembic import op

revision = "20260308_0051"
down_revision = "20260308_0050"
branch_labels = None
depends_on = None


def upgrade():
    # Sequence bo'lmasa yaratamiz
    op.execute("CREATE SEQUENCE IF NOT EXISTS user_code_seq")
    # code bo'sh bo'lgan barcha userlarga created_at bo'yicha 001, 002, ... beramiz
    op.execute("""
        WITH numbered AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
            FROM users
            WHERE code IS NULL
        )
        UPDATE users SET code = LPAD(n.rn::text, 3, '0')
        FROM numbered n
        WHERE users.id = n.id
    """)
    # Raqamli kodlardan max dan keyingi raqam sequence ga (yangi userlar to'g'ri kod olishi uchun)
    op.execute("""
        SELECT setval('user_code_seq', GREATEST(1, COALESCE(
            (SELECT MAX(CAST(code AS INTEGER)) FROM users WHERE code ~ '^[0-9]+$'), 0
        )))
    """)


def downgrade():
    pass
