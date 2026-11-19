"""One candidate per person: a newer CV replaces the older one

Three columns on ``candidate``, all additive (nothing existing changes meaning):

* ``previous_sha256`` (text[]): fingerprints of the person's earlier CVs. Only the newest CV is kept; an earlier file sent again is
  recognised by its fingerprint and joins the candidate instead of replacing the newer CV. Empty for every existing candidate.
* ``phone_key``: the last 9 digits of the phone, so a person is found by e-mail AND phone whatever way the number is written. Filled
  here from the stored phone.
* ``first_added_at``: when the person's first CV arrived (``uploaded_at`` is the current CV's date). Filled here from ``uploaded_at``.

Revision ID: 0033_same_person_cv
Revises: 0032_notice_acknowledgements
Create Date: 2026-11-18 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0033_same_person_cv'
down_revision: Union[str, None] = '0032_notice_acknowledgements'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("candidate", sa.Column("previous_sha256", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"))
    op.add_column("candidate", sa.Column("phone_key", sa.String(16), nullable=True))
    op.add_column("candidate", sa.Column("first_added_at", sa.DateTime(), nullable=True))
    op.execute("""
        UPDATE candidate
           SET first_added_at = uploaded_at,
               phone_key = CASE WHEN length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 9
                                THEN right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) END
    """)
    op.create_index("ix_candidate_phone_key", "candidate", ["phone_key"])
    op.create_index("ix_candidate_previous_sha256", "candidate", ["previous_sha256"], postgresql_using="gin")


def downgrade() -> None:
    op.drop_index("ix_candidate_previous_sha256", table_name="candidate")
    op.drop_index("ix_candidate_phone_key", table_name="candidate")
    op.drop_column("candidate", "first_added_at")
    op.drop_column("candidate", "phone_key")
    op.drop_column("candidate", "previous_sha256")
