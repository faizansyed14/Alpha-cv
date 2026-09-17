from pydantic import BaseModel, Field, EmailStr, field_validator
from typing import Optional


def _blank_to_none(v):
    """Treat an empty / whitespace-only string as "no value" so the UI can send
    ``email: ""`` for admin / CAPTCHA users without tripping EmailStr validation."""
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v

class LoginRequest(BaseModel):
    username: str
    password: str

class VerifyPasswordRequest(BaseModel):
    username: str
    password: str

class VerifyPasswordResponse(BaseModel):
    success: bool
    requires_otp: bool  # True for regular users, False for admin
    message: str
    # Second factor the client should present: "none" (admin), "otp" (email), or "captcha".
    auth_mode: str = "none"

class SendOTPRequest(BaseModel):
    username: str
    password: str  # Still verify password for security

class VerifyOTPRequest(BaseModel):
    username: str  # Username instead of email
    otp: str

# ---- Image CAPTCHA ----
class CaptchaRequest(BaseModel):
    username: str
    password: str  # verified before a challenge is issued
    fingerprint: str = ""  # client fingerprint, binds the challenge to this client

class CaptchaResponse(BaseModel):
    success: bool
    captcha_id: str
    image: str          # data:image/png;base64,...
    expires_in: int
    dev_code: Optional[str] = None  # DEV ONLY (OTP_DISABLE_EMAIL): the answer, for tests

class VerifyCaptchaRequest(BaseModel):
    username: str
    captcha_id: str
    answer: str
    fingerprint: str = ""

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

class UserCreate(BaseModel):
    username: str
    password: str
    email: Optional[EmailStr] = None  # Required for non-admin users
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

class UserUpdate(BaseModel):
    password: Optional[str] = None
    email: Optional[EmailStr] = None
    otp_mode: Optional[str] = Field(default=None, pattern="^(real|captcha)$")
    role: Optional[str] = Field(default=None, pattern="^(user|manager|admin|evp|account_manager)$")
    team_location: Optional[str] = Field(default=None, max_length=100)
    is_active: Optional[bool] = None

    _norm_email = field_validator("email", mode="before")(_blank_to_none)
    _norm_pw = field_validator("password", mode="before")(_blank_to_none)