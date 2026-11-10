"""Authentication dependencies.

Provides dependency callables to obtain the current user and enforce roles.
Readability and docstrings improved without altering behavior.
"""

import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session, select

from app.config.settings import settings
from app.db.database import get_session
from app.models.user import User
from app.security.auth import decode_token, issued_before_floor
import app.services.presence as presence
from app.security.logsafe import security_event

bearer = HTTPBearer(auto_error=True)

def get_current_user(
    token: HTTPAuthorizationCredentials = Depends(bearer),
    session: Session = Depends(get_session),
) -> User:
    """Resolve and return the current authenticated `User`.

    Accepts a Bearer token, decodes it, and fetches the corresponding user
    from the auth database. The LOCAL_AUTH mock user only exists when
    LOCAL_AUTH=true AND the environment is development.
    """
    try:
        data = decode_token(token.credentials)
        username = data.get("sub")
        if issued_before_floor(username, data.get("iat")):
            raise ValueError("token issued before the account's credentials changed")
    except Exception:
        security_event("token_rejected", logging.INFO)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    # Dev-only login bypass: never active in production.
    if settings.LOCAL_AUTH and settings.is_development and settings.LOCAL_AUTH_USERNAME:
        if username == settings.LOCAL_AUTH_USERNAME:
            class MockUser:
                def __init__(self):
                    self.id = "local-dev-1"
                    self.username = settings.LOCAL_AUTH_USERNAME
                    self.role = "admin"
                    self.is_active = True
                    # Keep parity with `User` model fields used by `/api/auth/me`
                    self.email = None

            presence.touch(username)
            return MockUser()

    user = session.exec(select(User).where(User.username == username)).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Inactive or unknown user",
        )
    presence.touch(user.username)
    return user

def require_user(user: User = Depends(get_current_user)) -> User:
    """Ensure a valid authenticated user is present (any active role).

    Used for endpoints every signed-in user needs regardless of role, e.g.
    /api/auth/me and /api/features.
    """
    return user


# Roles that may use the core ATS pages (CV/JD database, upload, matching,
# careers, email, performance). Tracker-only roles (e.g. account_manager) are
# intentionally excluded and get 403 on these endpoints.
CORE_APP_ROLES = ("admin", "user", "manager", "evp")


def require_core_app(user: User = Depends(get_current_user)) -> User:
    """Require a role that is allowed to use the core ATS pages.

    Blocks tracker-only roles (account_manager) from CV/JD/match/careers/etc.
    """
    if user.role not in CORE_APP_ROLES:
        security_event("access_denied", logging.WARNING, user=user.username, role=user.role, area="core_app")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This area is not available for your role.",
        )
    return user

def require_admin(user: User = Depends(get_current_user)) -> User:
    """Require the current user to have the `admin` role."""
    if user.role != "admin":
        security_event("access_denied", logging.WARNING, user=user.username, role=user.role, area="admin")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin only"
        )
    return user


def require_roles(*roles: str):
    """Return a dependency that requires the user to have one of `roles`."""
    allowed = set(r for r in roles if r)
    if not allowed:
        raise ValueError("require_roles() called with no roles")

    def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            security_event("access_denied", logging.WARNING, user=user.username, role=user.role, area="roles:" + ",".join(sorted(allowed)))
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return _dep
