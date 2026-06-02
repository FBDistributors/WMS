"""documents assignment timestamps; order_wms_state cancel metadata + backfill."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260601_0077"
down_revision = "20260521_0076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("first_assigned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "documents",
        sa.Column("last_assigned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "order_wms_state",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "order_wms_state",
        sa.Column("cancelled_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_order_wms_state_cancelled_by_user_id",
        "order_wms_state",
        "users",
        ["cancelled_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.execute(
        """
        UPDATE documents
        SET first_assigned_at = created_at
        WHERE assigned_to_user_id IS NOT NULL
          AND first_assigned_at IS NULL
        """
    )

    op.execute(
        """
        UPDATE order_wms_state ows
        SET
            cancelled_at = sub.cancelled_at,
            cancelled_by_user_id = sub.cancelled_by_user_id
        FROM (
            SELECT DISTINCT ON (al.entity_id)
                al.entity_id::uuid AS order_id,
                al.created_at AS cancelled_at,
                al.user_id AS cancelled_by_user_id
            FROM audit_logs al
            WHERE al.entity_type = 'order'
              AND al.new_data->>'status' = 'cancelled'
            ORDER BY al.entity_id, al.created_at DESC
        ) sub
        WHERE ows.order_id = sub.order_id
          AND ows.status = 'cancelled'
          AND ows.cancelled_at IS NULL
        """
    )

    op.execute(
        """
        UPDATE order_wms_state ows
        SET
            cancelled_at = COALESCE(ows.cancelled_at, s.completed_at, s.created_at),
            cancelled_by_user_id = COALESCE(ows.cancelled_by_user_id, s.initiated_by_user_id)
        FROM safe_cancel_return_sessions s
        WHERE s.order_id = ows.order_id
          AND s.status = 'completed'
          AND ows.status = 'cancelled'
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_order_wms_state_cancelled_by_user_id", "order_wms_state", type_="foreignkey")
    op.drop_column("order_wms_state", "cancelled_by_user_id")
    op.drop_column("order_wms_state", "cancelled_at")
    op.drop_column("documents", "last_assigned_at")
    op.drop_column("documents", "first_assigned_at")
