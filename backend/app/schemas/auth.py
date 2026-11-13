from pydantic import BaseModel, Field, EmailStr, field_validator, model_validator

from app.security.password_policy import password_problem
from app.security.rbac_rules import LOCATIONS, LOCATION_ROLES, ROLE_PATTERN
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
    # Second factor the client should present: "none" (admin), "otp" (email), "captcha" or "totp" (authenticator app).
    auth_mode: str = "none"
    # For "totp": false = the person has not set the app up yet (the next step shows the QR code), true = just ask for the code.
    totp_enrolled: Optional[bool] = None

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

# ---- Authenticator app (TOTP) ----
class TotpSetupRequest(_SignInBody):
    email: str = Field(..., max_length=320)
    password: str = Field(..., max_length=256)  # verified before the QR code is shown

class TotpSetupResponse(BaseModel):
    success: bool
    qr: str             # data:image/svg+xml;base64,... the QR code to scan
    secret: str         # the same secret in groups of four, to type into the app by hand
    issuer: str
    account: str

class VerifyTotpRequest(_SignInBody):
    email: str = Field(..., max_length=320)
    password: str = Field(..., max_length=256)  # a code alone proves nothing (any account has one), so the password is checked with it
    code: str = Field(..., max_length=16)

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
    location: Optional[str] = None
    totp_enrolled: bool = False     # on the authenticator: has the person finished setting the app up

class MeRead(BaseModel):
    """What /api/auth/me tells the page about whoever is signed in. No email: nothing in the app needs it, and it should not travel
    (or sit in a browser's memory, a log or a screenshot) for no reason."""
    id: str
    username: str
    role: str
    is_active: bool
    location: Optional[str] = None

class UserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., max_length=256)
    email: EmailStr   # what the person signs in with: required, and one account per address
    otp_mode: str = Field(default="real", pattern="^(real|captcha|totp)$")
    # Roles (see app/security/rbac_rules.py): user = recruiter, manager = recruitment manager, evp, account_manager = sales manager.
    # All of them have the same access; only the admin (never created here) can manage users, agents, monitoring and bug reports.
    role: str = Field(default="user", pattern=ROLE_PATTERN)
    # Dubai or Abu Dhabi. Required for recruiters, recruitment managers and sales managers; the EVP sees every location (nothing is stored).
    # It is chosen here, when the login is created.
    location: Optional[str] = None

    _norm_email = field_validator("email", mode="before")(_blank_to_none)
    _norm_location = field_validator("location", mode="before")(_blank_to_none)

    @field_validator("location")
    @classmethod
    def _known_location(cls, v):
        if v is not None and v not in LOCATIONS:
            raise ValueError("Location must be one of: " + ", ".join(LOCATIONS))
        return v

    @model_validator(mode="after")
    def _password_rules(self):
        problem = password_problem(self.password, username=self.username, email=str(self.email))
        if problem:
            raise ValueError(problem)
        if self.role in LOCATION_ROLES and not self.location:
            raise ValueError("Location is required for recruiters, recruitment managers and sales managers")
        if self.role not in LOCATION_ROLES:
            self.location = None
        return self

class UserUpdate(BaseModel):
    password: Optional[str] = Field(default=None, max_length=256)
    email: Optional[EmailStr] = None
    otp_mode: Optional[str] = Field(default=None, pattern="^(real|captcha|totp)$")
    role: Optional[str] = Field(default=None, pattern=ROLE_PATTERN)
    is_active: Optional[bool] = None
    # Only accepted for an account that has no location yet (an account made before locations existed). Once set it cannot be changed.
    location: Optional[str] = None

    _norm_email = field_validator("email", mode="before")(_blank_to_none)
    _norm_location = field_validator("location", mode="before")(_blank_to_none)

    @field_validator("location")
    @classmethod
    def _known_location(cls, v):
        if v is not None and v not in LOCATIONS:
            raise ValueError("Location must be one of: " + ", ".join(LOCATIONS))
        return v

    _norm_pw = field_validator("password", mode="before")(_blank_to_none)

    @field_validator("password")
    @classmethod
    def _password_rules(cls, v):
        # who the password belongs to is checked in the route (it knows the account); length and common-password rules apply here
        problem = password_problem(v) if v else None
        if problem:
            raise ValueError(problem)
        return v