"""User code: sequence for auto 001, 002; backfill existing users.

Revision ID: 20260308_0050
Revises: 20260308_0049
Create Date: 2026-03-08

"""
from alembic import op
import sqlalchemy as sa

revision = "20260308_0050"
down_revision = "20260308_0049"
branch_labels = None
depends_on = None


def upgrade():
    # Sequence for ketma-ket kod (001, 002, ...)
    op.execute("CREATE SEQUENCE IF NOT EXISTS user_code_seq")
    # Mavjud userlar uchun code bo'sh bo'lsa, created_at bo'yicha 001, 002, ... beramiz
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
    # Sequence ni max(code)+1 ga o'rnatamiz (keyingi create da nextval to'g'ri ishlashi uchun)
    op.execute("""
        SELECT setval('user_code_seq', GREATEST(1, COALESCE(
            (SELECT MAX(CAST(code AS INTEGER)) FROM users WHERE code ~ '^[0-9]+$'), 0
        )))
    """)


def downgrade():
    op.execute("DROP SEQUENCE IF EXISTS user_code_seq")
