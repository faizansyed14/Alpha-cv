"""everyone signs in with their email: addresses are stored in lower case and each belongs to one account

Revision ID: 0016_unique_user_email
Revises: 0015_bug_report_drop_page_url
Create Date: 2026-11-09 20:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0016_unique_user_email'
down_revision: Union[str, None] = '0015_bug_report_drop_page_url'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    taken = bind.execute(sa.text(
        'SELECT lower(trim(email)), count(*) FROM "user" WHERE email IS NOT NULL AND trim(email) <> \'\' GROUP BY 1 HAVING count(*) > 1')).all()
    if taken:
        listed = ", ".join(f"{email} ({n} accounts)" for email, n in taken)
        raise RuntimeError(f"Two accounts share an email address, and now each address may belong to one account only. "
                           f"Change one of them first (Users page, or UPDATE \"user\" SET email = ...): {listed}")
    bind.execute(sa.text('UPDATE "user" SET email = lower(trim(email)) WHERE email IS NOT NULL'))
    bind.execute(sa.text('UPDATE "user" SET email = NULL WHERE email = \'\''))
    op.create_index("uq_user_email_lower", "user", [sa.text("lower(email)")], unique=True)


def downgrade() -> None:
    op.drop_index("uq_user_email_lower", table_name="user")
