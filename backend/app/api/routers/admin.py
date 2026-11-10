from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from sqlalchemy import func
from sqlmodel import Session, select
from app.db.database import get_session
from app.models.user import User
from app.schemas.auth import UserCreate, UserRead, UserUpdate
import logging

from app.security.auth import hash_password, invalidate_user_tokens
from app.security.logsafe import mask_email, security_event
from app.security.password_policy import password_problem
from app.api.deps import require_admin
from app.security.rbac_rules import ADMIN_ROLE, TEAM_LOCATIONS
from app.services.auth_mode import normalize_otp_mode

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _refuse(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _check_location(value):
    """A team location is one of the known teams (or empty). "dubai" and "abudhabi" are accepted and stored as "Dubai" and "Abu Dhabi"."""
    value = (value or "").strip()
    if not value:
        return None
    known = {t.lower().replace(" ", ""): t for t in TEAM_LOCATIONS}
    team = known.get(value.lower().replace(" ", "").replace("-", "").replace("_", ""))
    if team is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Team location must be one of: {', '.join(TEAM_LOCATIONS)}")
    return team


def _email_taken(session: Session, email: str, except_id: str = "") -> bool:
    """Is this address (any capitals) already the sign-in of another account?"""
    q = select(User).where(func.lower(User.email) == email.strip().lower())
    if except_id:
        q = q.where(User.id != except_id)
    return session.exec(q).first() is not None


def _read(user: User) -> UserRead:
    return UserRead(
        id=user.id, username=user.username, role=user.role, is_active=user.is_active, email=user.email,
        otp_mode=normalize_otp_mode(getattr(user, "otp_mode", "real")), team_location=getattr(user, "team_location", None),
    )

@router.get("/presence")
def users_presence(_: User = Depends(require_admin)):
    """Who is currently online (made an authenticated request within the TTL).

    Returns ``{username: {online: bool, last_seen: epoch|null}}`` plus the TTL so
    the admin UI can render a blue/red dot and a "last seen" hint.
    """
    import time as _time
    import app.services.presence as presence
    snap = presence.snapshot()
    return {
        "ttl_seconds": presence.ttl_seconds(),
        "server_time": int(_time.time()),
        "users": snap,
        "online": sorted(n for n, v in snap.items() if v.get("online")),
    }


@router.get("/users", response_model=List[UserRead])
def list_users(_: User = Depends(require_admin), session: Session = Depends(get_session)):
    users = session.exec(select(User)).all()
    return [
        UserRead(
            id=u.id,
            username=u.username,
            role=u.role,
            is_active=u.is_active,
            email=u.email,
            otp_mode=normalize_otp_mode(getattr(u, "otp_mode", "real")),
            team_location=getattr(u, "team_location", None),
        )
        for u in users
    ]

@router.post("/users", response_model=UserRead, status_code=201)
def create_user(data: UserCreate, actor: User = Depends(require_admin), session: Session = Depends(get_session)):
    existing = session.exec(select(User).where(User.username == data.username)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")
    
    # The administrator account is seeded from the environment; it is not created (or promoted to) through the API.
    if data.role == ADMIN_ROLE:
        raise _refuse("Admin accounts cannot be created here. The administrator is set up once from the server configuration.")
    team_location = _check_location(data.team_location)

    email = str(data.email).strip().lower()           # what the person signs in with
    if _email_taken(session, email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email address already belongs to another account")

    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        email=email,
        otp_mode=data.otp_mode or "real",
        role=data.role,
        team_location=team_location,
        is_active=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    security_event("user_created", by=actor.username, user=user.username, role=user.role)
    return _read(user)

@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(user_id: str, data: UserUpdate, actor: User = Depends(require_admin), session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.id == user_id)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.role == ADMIN_ROLE:
        # An admin account keeps its role, stays active, has no team and always uses the CAPTCHA. Its email and password are set in the
        # server's .env file (applied at every start): nobody changes them here, the admin included.
        if (data.role and data.role != ADMIN_ROLE) or data.is_active is False:
            raise _refuse("The admin account cannot be demoted or deactivated.")
        if data.team_location:
            raise _refuse("The admin account has no team location.")
        if data.otp_mode and data.otp_mode != "captcha":
            raise _refuse("The admin account always signs in with the CAPTCHA.")
        if data.password or data.email is not None:
            raise _refuse("The admin's email and password are set in the server's .env file (ADMIN_EMAIL, ADMIN_PASSWORD) and cannot be changed here.")
        data.role, data.team_location, data.is_active = None, None, None
    else:
        if data.role == ADMIN_ROLE:
            raise _refuse("Accounts cannot be promoted to admin here.")
        if data.team_location is not None:
            data.team_location = _check_location(data.team_location) or ""

    credentials_changed = False
    if data.password:
        problem = password_problem(data.password, username=user.username, email=str(data.email or user.email or ""))
        if problem:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=problem)
        user.password_hash = hash_password(data.password)
        credentials_changed = True
    if data.otp_mode:
        user.otp_mode = data.otp_mode
    if data.email is not None:
        email = str(data.email).strip().lower()
        if _email_taken(session, email, except_id=user.id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email address already belongs to another account")
        credentials_changed = credentials_changed or (user.email or "") != email
        user.email = email
    role_before, active_before = user.role, user.is_active
    if data.role:
        # Validate: if changing to non-admin, ensure email exists when using real OTP
        new_otp_mode = data.otp_mode if data.otp_mode else getattr(user, "otp_mode", "real")
        if data.role != "admin" and new_otp_mode != "captcha" and not user.email and not data.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is required for non-admin users when OTP mode is real"
            )
        user.role = data.role
    if data.team_location is not None:
        user.team_location = data.team_location or None
    if data.is_active is not None:
        user.is_active = data.is_active
    session.add(user)
    session.commit()
    session.refresh(user)
    if credentials_changed or (data.is_active is False):
        invalidate_user_tokens(user.username)        # sessions opened with the old password / email stop working now
    security_event("user_updated", by=actor.username, user=user.username, password_changed=bool(data.password),
                   email_changed=data.email is not None, role=user.role if user.role != role_before else None,
                   active=user.is_active if user.is_active != active_before else None)
    return _read(user)

@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str, actor: User = Depends(require_admin), session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.id == user_id)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == ADMIN_ROLE:
        raise _refuse("The admin account cannot be deleted.")
    gone = user.username
    session.delete(user)
    session.commit()
    invalidate_user_tokens(gone)
    security_event("user_deleted", logging.WARNING, by=actor.username, user=gone)
    return {}
