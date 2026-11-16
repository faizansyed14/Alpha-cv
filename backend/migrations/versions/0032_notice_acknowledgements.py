"""Login notice: who has acknowledged it

Two columns on ``user``: ``notice_ack_id`` is the id of the notice the person acknowledged with the thumbs-up on the popup, and
``notice_ack_at`` is when. The popup is then not shown to them again, and the admin's Users page lists who has and who has not acknowledged
the current notice. There is one notice at a time and its id changes with its text, so no other table is needed. Existing accounts have
acknowledged nothing.

Revision ID: 0032_notice_acknowledgements
Revises: 0031_authenticator_mfa
Create Date: 2026-11-16 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0032_notice_acknowledgements'
down_revision: Union[str, None] = '0031_authenticator_mfa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user", sa.Column("notice_ack_id", sa.String(), nullable=True))
    op.add_column("user", sa.Column("notice_ack_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("user", "notice_ack_at")
    op.drop_column("user", "notice_ack_id")
