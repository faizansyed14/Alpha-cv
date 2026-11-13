"""tracker: the recruitment manager and the sales manager a requirement is assigned to

The sales manager of the requirements that exist is the one who added them (when that person is a sales manager).

Revision ID: 0027_requirement_manager
Revises: 0026_multi_recruiters
Create Date: 2026-11-12 20:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0027_requirement_manager'
down_revision: Union[str, None] = '0026_multi_recruiters'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("requirement", sa.Column("manager_id", sa.String(length=36), nullable=True))
    op.add_column("requirement", sa.Column("sales_manager_id", sa.String(length=36), nullable=True))
    op.create_index("ix_requirement_manager", "requirement", ["manager_id"])
    op.create_index("ix_requirement_sales_manager", "requirement", ["sales_manager_id"])
    op.execute("UPDATE requirement SET sales_manager_id = (SELECT u.id FROM \"user\" u WHERE u.username = requirement.created_by "
               "AND u.role = 'account_manager' LIMIT 1)")


def downgrade() -> None:
    op.drop_index("ix_requirement_sales_manager", table_name="requirement")
    op.drop_index("ix_requirement_manager", table_name="requirement")
    op.drop_column("requirement", "sales_manager_id")
    op.drop_column("requirement", "manager_id")
