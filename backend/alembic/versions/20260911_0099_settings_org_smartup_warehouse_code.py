"""settings_organizations.smartup_warehouse_code — diller Smartup ombor kodi.

Diller sanovini Smartup qoldig'i bilan solishtirish uchun `balance$export` ga
filial ID bilan birga ombor kodi kerak. Samarqand dilleri uchun kod harakatlardan
ma'lum (`wh30`) — oldindan to'ldiriladi; qolganlarini admin kiritadi.

Revision ID: 20260911_0099
Revises: 20260911_0098
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260911_0099"
down_revision = "20260911_0098"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "settings_organizations",
        sa.Column("smartup_warehouse_code", sa.String(length=32), nullable=True),
    )
    op.execute(
        "UPDATE settings_organizations SET smartup_warehouse_code = 'wh30' "
        "WHERE org_id = '3050589' AND smartup_warehouse_code IS NULL"
    )


def downgrade() -> None:
    op.drop_column("settings_organizations", "smartup_warehouse_code")
