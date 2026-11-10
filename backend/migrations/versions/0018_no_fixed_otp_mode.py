"""the "fixed OTP" sign-in mode no longer exists: accounts still set to it use the CAPTCHA, as the code always treated them

Revision ID: 0018_no_fixed_otp_mode
Revises: 0017_saved_candidate
Create Date: 2026-11-10 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0018_no_fixed_otp_mode'
down_revision: Union[str, None] = '0017_saved_candidate'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.get_bind().execute(sa.text('UPDATE "user" SET otp_mode = \'captcha\' WHERE lower(trim(otp_mode)) = \'fixed\''))


def downgrade() -> None:
    pass          # nothing to restore: "fixed" was never a mode the app offered again
