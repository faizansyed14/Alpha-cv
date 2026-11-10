from pydantic import BaseModel, Field, EmailStr, field_validator, model_validator

from app.security.password_policy import password_problem
from typing import Optional


def _blank_to_none(v):
    """Treat an empty / whitespace-only string as "no value" so the UI can send
    ``email: ""`` for admin / CAPTCHA users without tripping EmailStr validation."""
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v

# Everyone signs in with their email address and password. The username is only the name shown in the app. (``email`` is a plain
# string here, not EmailStr: a malformed address is just a failed sign-in, answered like any other wrong credentials.)
class _SignInBody(BaseModel):
    """Sign-in bodies come from anyone on the internet: no NUL characters (PostgreSQL cannot store them: a NUL in an email
    used to reach the database and end as a 500), and every field has a size limit."""

    @field_validator("*", mode="after")
    @classmethod
    def _no_nul(cls, v):
        if isinstance(v, str) and "\x00" in v:
            raise ValueError("contains an invalid character")
        return v


class LoginRequest(_SignInBody):
    email: str = Field(..., max_length=320)
    password: str = Field(..., max_length=256)

class VerifyPasswordRequest(_SignInBody):
    email: str = Field(..., max_length=320)
    password: str = Field(..., max_length=256)

class VerifyPasswordResponse(BaseModel):
    success: bool
    requires_otp: bool  # True for regular users, False for admin
    message: str
    # Second factor the client should present: "none" (admin), "otp" (email), or "captcha".
    auth_mode: str = "none"

class SendOTPRequest(_SignInBody):
    email: str = Field(..., max_length=320)
    password: str = Field(..., max_length=256)  # Still verify password for security

class VerifyOTPRequest(_SignInBody):
    email: str = Field(..., max_length=320)
    otp: str = Field(..., max_length=16)

# ---- Image CAPTCHA ----
class CaptchaRequest(_SignInBody):
    email: str = Field(..., max_length=320)
    password: str = Field(..., max_length=256)  # verified before a challenge is issued
    fingerprint: str = Field("", max_length=256)  # client fingerprint, binds the challenge to this client

class CaptchaResponse(BaseModel):
    success: bool
    captcha_id: str
    image: str          # data:image/png;base64,...
    expires_in: int
    dev_code: Optional[str] = None  # DEV ONLY (OTP_DISABLE_EMAIL): the answer, for tests

class VerifyCaptchaRequest(_SignInBody):
    email: str = Field(..., max_length=320)
    captcha_id: str = Field(..., max_length=128)
    answer: str = Field(..., max_length=32)
    fingerprint: str = Field("", max_length=256)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    role: str

class OTPResponse(BaseModel):
    message: str
    success: bool
    masked_email: Optional[str] = None  # Masked email for display (e.g., "syed****@example.com")
    dev_otp: Optional[str] = None  # DEV ONLY (OTP_DISABLE_EMAIL): the OTP, for local/tests

class UserRead(BaseModel):
    id: str
    username: str
    role: str
    is_active: bool
    email: Optional[str] = None
    otp_mode: str = "real"
    team_location: Optional[str] = None

class MeRead(BaseModel):
    """What /api/auth/me tells the page about whoever is signed in. No email: nothing in the app needs it, and it should not travel
    (or sit in a browser's memory, a log or a screenshot) for no reason."""
    id: str
    username: str
    role: str
    is_active: bool

class UserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., max_length=256)
    email: EmailStr   # what the person signs in with: required, and one account per address
    otp_mode: str = Field(default="real", pattern="^(real|captcha)$")
    # Roles:
    # - admin: full access (all pages + user management)
    # - manager: tracker requirements + candidates (location-scoped)
    # - user: recruiter persona (tracker read + follow-ups; core ATS pages)
    # - evp: manager-level access across all locations
    # - account_manager: TRACKER ONLY (no CV/JD/match/careers/upload access)
    role: str = Field(default="user", pattern="^(user|manager|admin|evp|account_manager)$")
    team_location: Optional[str] = Field(default=None, max_length=100)

    _norm_email = field_validator("email", mode="before")(_blank_to_none)
    _norm_team = field_validator("team_location", mode="before")(_blank_to_none)

    @model_validator(mode="after")
    def _password_rules(self):
        problem = password_problem(self.password, username=self.username, email=str(self.email))
        if problem:
            raise ValueError(problem)
        return self

class UserUpdate(BaseModel):
    password: Optional[str] = Field(default=None, max_length=256)
    email: Optional[EmailStr] = None
    otp_mode: Optional[str] = Field(default=None, pattern="^(real|captcha)$")
    role: Optional[str] = Field(default=None, pattern="^(user|manager|admin|evp|account_manager)$")
    team_location: Optional[str] = Field(default=None, max_length=100)
    is_active: Optional[bool] = None

    _norm_email = field_validator("email", mode="before")(_blank_to_none)
    _norm_pw = field_validator("password", mode="before")(_blank_to_none)

    @field_validator("password")
    @classmethod
    def _password_rules(cls, v):
        # who the password belongs to is checked in the route (it knows the account); length and common-password rules apply here
        problem = password_problem(v) if v else None
        if problem:
            raise ValueError(problem)
        return v