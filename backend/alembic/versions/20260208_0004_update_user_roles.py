"""Map legacy roles to new WMS roles.

Revision ID: 20260208_0004
Revises: 20260205_0003
Create Date: 2026-02-08 00:40:00.000000
"""
from alembic import op

revision = "20260208_0004"
down_revision = "20260205_0003"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "UPDATE users SET role = 'warehouse_admin' WHERE role IN ('admin', 'warehouse_admin')"
    )
    op.execute("UPDATE users SET role = 'supervisor' WHERE role IN ('manager', 'supervisor')")


def downgrade():
    op.execute("UPDATE users SET role = 'admin' WHERE role = 'warehouse_admin'")
    op.execute("UPDATE users SET role = 'manager' WHERE role = 'supervisor'")
    op.execute("UPDATE users SET role = 'picker' WHERE role IN ('receiver', 'inventory_controller')")
