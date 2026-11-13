from sqlalchemy import CheckConstraint, Index, text
from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime
import uuid

from app.security.rbac_rules import ALL_ROLES, LOCATION_ROLES, LOCATIONS

OTP_MODES = ("real", "captcha")


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class User(SQLModel, table=True):
    __table_args__ = (
        # Everyone signs in with their email, so an address belongs to one account only (any capitals).
        Index("uq_user_email_lower", text("lower(email)"), unique=True),
        # The database itself refuses what the app never writes, so a manual edit or a script cannot store a role, MFA mode or location the app
        # does not know. The values come from app/security/rbac_rules.py; migration 0030 holds the same lists as literals.
        CheckConstraint(_in("role", ALL_ROLES), name="ck_user_role"),
        CheckConstraint(_in("otp_mode", OTP_MODES), name="ck_user_otp_mode"),
        CheckConstraint("location IS NULL OR " + _in("location", LOCATIONS), name="ck_user_location"),
        # the EVP and the admin see every location, so they have none
        CheckConstraint("location IS NULL OR " + _in("role", LOCATION_ROLES), name="ck_user_location_roles"),
    )

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True, index=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    email: Optional[str] = Field(default=None, index=True)  # what the person signs in with (and where the OTP goes)
    # Second-factor auth mode (admin-controlled):
    # - real:    generate a random OTP and email it
    # - captcha: show an image CAPTCHA instead of email OTP (no email needed)
    otp_mode: str = Field(default="real")
    # Role is plain text. "admin" is the only role with extra powers (users, agents, monitoring, bug reports, agent usage);
    # every other role (see app/security/rbac_rules.py) has exactly the same access.
    role: str = Field(default="user")
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Dubai or Abu Dhabi (rbac_rules.LOCATIONS). Required for recruiters, recruitment managers and sales managers and chosen when the
    # login is created; empty for the EVP and the admin, who see every location.
    location: Optional[str] = Field(default=None)
