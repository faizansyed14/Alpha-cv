"""Authenticator-app (TOTP) sign-in step

* ``user.otp_mode`` may now also be ``totp`` (Microsoft Authenticator, Google Authenticator ...): the check constraint is replaced.
* ``user.totp_secret`` holds the account's secret ENCRYPTED, ``totp_enrolled`` says the person finished the setup with a correct code, and
  ``totp_last_step`` is the time step of the last code accepted (a code works once).
Existing accounts are untouched (their secret is empty and enrolled is false).

Revision ID: 0031_authenticator_mfa
Revises: 0030_integrity_and_storage
Create Date: 2026-11-13 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0031_authenticator_mfa'
down_revision: Union[str, None] = '0030_integrity_and_storage'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_MODES = ("real", "captcha", "totp")
OLD_MODES = ("real", "captcha")


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.add_column("user", sa.Column("totp_secret", sa.String(), nullable=True))
    op.add_column("user", sa.Column("totp_enrolled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("user", sa.Column("totp_last_step", sa.Integer(), nullable=True))
    op.drop_constraint("ck_user_otp_mode", "user", type_="check")
    op.create_check_constraint("ck_user_otp_mode", "user", _in("otp_mode", NEW_MODES))


def downgrade() -> None:
    # accounts on the authenticator go back to the email code (the only mode every account can use)
    op.execute("UPDATE \"user\" SET otp_mode = 'real' WHERE otp_mode = 'totp'")
    op.drop_constraint("ck_user_otp_mode", "user", type_="check")
    op.create_check_constraint("ck_user_otp_mode", "user", _in("otp_mode", OLD_MODES))
    op.drop_column("user", "totp_last_step")
    op.drop_column("user", "totp_enrolled")
    op.drop_column("user", "totp_secret")
