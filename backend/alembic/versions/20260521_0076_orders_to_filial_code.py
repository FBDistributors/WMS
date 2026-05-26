"""orders.to_filial_code — SmartUP manzil tashkiloti (to_filial_code)."""

from alembic import op
import sqlalchemy as sa

revision = "20260521_0076"
down_revision = "20260521_0075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("to_filial_code", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_orders_to_filial_code", "orders", ["to_filial_code"])
    # Eski yozuvlar: filial_id ba'zan ombor kodi (001) — to_filial_code bo'sh qoladi, sinxron yangilaydi
    op.execute(
        """
        UPDATE orders
        SET to_filial_code = filial_id
        WHERE source = 'diller'
          AND filial_id IS NOT NULL
          AND length(trim(filial_id)) >= 7
          AND filial_id ~ '^[0-9]+$'
        """
    )


def downgrade() -> None:
    op.drop_index("ix_orders_to_filial_code", table_name="orders")
    op.drop_column("orders", "to_filial_code")
