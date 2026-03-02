"""Create documents and picking tables.

Revision ID: 20260205_0001
Revises: None
Create Date: 2026-02-05 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260205_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("doc_no", sa.String(length=64), nullable=False),
        sa.Column("doc_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("doc_no", "doc_type", name="uq_documents_doc_no_doc_type"),
    )
    op.create_index("ix_documents_doc_no", "documents", ["doc_no"])
    op.create_index("ix_documents_status", "documents", ["status"])

    op.create_table(
        "document_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sku", sa.String(length=64), nullable=True),
        sa.Column("product_name", sa.String(length=128), nullable=False),
        sa.Column("barcode", sa.String(length=64), nullable=True),
        sa.Column("location_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("required_qty", sa.Float(), nullable=False),
        sa.Column("picked_qty", sa.Float(), nullable=False, server_default="0"),
    )
    op.create_index("ix_document_lines_document_id", "document_lines", ["document_id"])

    op.create_table(
        "pick_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=False),
        sa.Column(
            "line_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("document_lines.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_pick_requests_request_id", "pick_requests", ["request_id"], unique=True
    )


def downgrade():
    op.drop_index("ix_pick_requests_request_id", table_name="pick_requests")
    op.drop_table("pick_requests")
    op.drop_index("ix_document_lines_document_id", table_name="document_lines")
    op.drop_table("document_lines")
    op.drop_index("ix_documents_status", table_name="documents")
    op.drop_index("ix_documents_doc_no", table_name="documents")
    op.drop_table("documents")
