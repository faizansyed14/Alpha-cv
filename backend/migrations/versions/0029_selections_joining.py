"""tracker: selections and joining (a row is made for each requirement that is closed)

Revision ID: 0029_selections_joining
Revises: 0028_stemmed_cv_search
Create Date: 2026-11-12 23:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0029_selections_joining'
down_revision: Union[str, None] = '0028_stemmed_cv_search'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "selection",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("requirement_id", sa.String(length=36), nullable=True, unique=True),
        sa.Column("location", sa.String(length=32), nullable=True),
        sa.Column("selection_date", sa.Date(), nullable=False),
        sa.Column("candidate_name", sa.String(length=160), nullable=True),
        sa.Column("position", sa.String(length=160), nullable=False),
        sa.Column("client", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="offer_pending"),
        sa.Column("sales_manager_id", sa.String(length=36), nullable=True),
        sa.Column("manager_id", sa.String(length=36), nullable=True),
        sa.Column("comments", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("status IN ('offer_pending', 'offer_released', 'joined', 'backed_out')", name="ck_selection_status"),
        sa.CheckConstraint("location IS NULL OR location IN ('Dubai', 'Abu Dhabi')", name="ck_selection_location"),
    )
    op.create_index("ix_selection_location_date", "selection", ["location", "selection_date"])
    op.create_index("ix_selection_status", "selection", ["status"])
    op.create_index("ix_selection_date", "selection", ["selection_date"])
    op.create_table(
        "selection_recruiter",
        sa.Column("selection_id", sa.String(length=36), sa.ForeignKey("selection.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recruiter_id", sa.String(length=36), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("selection_id", "recruiter_id"),
    )
    op.create_index("ix_selection_recruiter_user", "selection_recruiter", ["recruiter_id"])


def downgrade() -> None:
    op.drop_index("ix_selection_recruiter_user", table_name="selection_recruiter")
    op.drop_table("selection_recruiter")
    op.drop_index("ix_selection_date", table_name="selection")
    op.drop_index("ix_selection_status", table_name="selection")
    op.drop_index("ix_selection_location_date", table_name="selection")
    op.drop_table("selection")
