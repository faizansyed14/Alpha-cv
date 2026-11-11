from sqlalchemy import Index, text
from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime
import uuid

class User(SQLModel, table=True):
    # Everyone signs in with their email, so an address belongs to one account only (any capitals).
    __table_args__ = (Index("uq_user_email_lower", text("lower(email)"), unique=True),)

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