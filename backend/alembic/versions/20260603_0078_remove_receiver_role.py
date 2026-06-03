"""Remove receiver role; migrate users to picker with receiving permissions."""

from alembic import op

revision = "20260603_0078"
down_revision = "20260601_0077"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE users
        SET granted_permissions = (
            SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
            FROM (
                SELECT jsonb_array_elements_text(
                    COALESCE(granted_permissions, '[]'::jsonb)
                    || '["receiving:read", "receiving:write"]'::jsonb
                ) AS elem
            ) merged
        )
        WHERE role = 'receiver'
        """
    )
    op.execute("UPDATE users SET role = 'picker' WHERE role = 'receiver'")


def downgrade() -> None:
    op.execute(
        """
        UPDATE users
        SET role = 'receiver'
        WHERE role = 'picker'
          AND granted_permissions ? 'receiving:write'
          AND NOT (granted_permissions ? 'picking:write')
        """
    )
