"""Add vip_customers table (VIP mijozlar, muddat chegarasi).

Revision ID: 20260307_0048
Revises: 20260305_0047
Create Date: 2026-03-07

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260307_0048"
down_revision = "20260305_0047"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "vip_customers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("customer_id", sa.String(length=64), nullable=False),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("min_expiry_months", sa.Integer(), nullable=False, server_default=sa.text("6")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_vip_customers_customer_id", "vip_customers", ["customer_id"])
    op.create_unique_constraint("uq_vip_customers_customer_id", "vip_customers", ["customer_id"])


def downgrade():
    op.drop_constraint("uq_vip_customers_customer_id", "vip_customers", type_="unique")
    op.drop_index("ix_vip_customers_customer_id", table_name="vip_customers")
    op.drop_table("vip_customers")
