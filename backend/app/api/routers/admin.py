from fastapi import APIRouter, Depends, HTTPException, Response, status
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
from app.security.rbac_rules import ADMIN_ROLE, LOCATION_ROLES
from app.services.auth_mode import normalize_otp_mode
from app.store import get_store

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _refuse(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _email_taken(session: Session, email: str, except_id: str = "") -> bool:
    """Is this address (any capitals) already the sign-in of another account?"""
    q = select(User).where(func.lower(User.email) == email.strip().lower())
    if except_id:
        q = q.where(User.id != except_id)
    return session.exec(q).first() is not None


def _switch_off_jobs(user: User, actor: User) -> int:
    """A deactivated person's Careers jobs stop taking applications. Nothing is deleted, and turning the person back on does not turn the jobs
    back on: each is switched on again in Careers. A failure here is logged, not shown: the person is deactivated either way."""
    try:
        count = get_store().deactivate_jobs_posted_by(user.username)
    except Exception as exc:  # noqa: BLE001
        logging.getLogger(__name__).error(f"Could not deactivate the jobs of {user.username}: {exc}")
        return 0
    if count:
        security_event("jobs_deactivated", by=actor.username, user=user.username, jobs=count, reason="user_deactivated")
    return count


def _read(user: User) -> UserRead:
    return UserRead(
        id=user.id, username=user.username, role=user.role, is_active=user.is_active, email=user.email, location=user.location,
        otp_mode=normalize_otp_mode(getattr(user, "otp_mode", "real")),
        totp_enrolled=bool(getattr(user, "totp_enrolled", False)),
    )

def _forget_authenticator(user: User) -> None:
    """Remove the authenticator secret: the person scans a new QR code at their next sign-in."""
    user.totp_secret = None
    user.totp_enrolled = False
    user.totp_last_step = None


@router.post("/users/{user_id}/reset-authenticator", response_model=UserRead)
def reset_authenticator(user_id: str, actor: User = Depends(require_admin), session: Session = Depends(get_session)):
    """For a lost or replaced phone: the account's authenticator secret is removed (and its sessions end), so the next sign-in shows a new
    QR code to scan. The account stays on the authenticator."""
    user = session.exec(select(User).where(User.id == user_id)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if normalize_otp_mode(user.otp_mode) != "totp":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This account does not use an authenticator app.")
    _forget_authenticator(user)
    session.add(user)
    session.commit()
    session.refresh(user)
    invalidate_user_tokens(user.username)
    security_event("totp_reset", by=actor.username, user=user.username)
    return _read(user)


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


@router.get("/database-health")
def database_health(_: User = Depends(require_admin)):
    """Sizes, dead rows and warnings for the PostgreSQL database (the CV search index above all): see app/services/db_health.py."""
    from app.db.database import engine
    from app.services.db_health import storage_report

    return storage_report(engine)


@router.get("/users", response_model=List[UserRead])
def list_users(_: User = Depends(require_admin), session: Session = Depends(get_session)):
    return [_read(u) for u in session.exec(select(User)).all()]

@router.post("/users", response_model=UserRead, status_code=201)
def create_user(data: UserCreate, actor: User = Depends(require_admin), session: Session = Depends(get_session)):
    existing = session.exec(select(User).where(User.username == data.username)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")
    
    # The administrator account is seeded from the environment; it is not created (or promoted to) through the API.
    if data.role == ADMIN_ROLE:
        raise _refuse("Admin accounts cannot be created here. The administrator is set up once from the server configuration.")

    email = str(data.email).strip().lower()           # what the person signs in with
    if _email_taken(session, email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email address already belongs to another account")

    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        email=email,
        otp_mode=data.otp_mode or "real",
        role=data.role,
        location=data.location,
        is_active=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    security_event("user_created", by=actor.username, user=user.username, role=user.role, location=user.location)
    return _read(user)

@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(user_id: str, data: UserUpdate, actor: User = Depends(require_admin), session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.id == user_id)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.role == ADMIN_ROLE:
        # An admin account keeps its role and stays active. Its email and password are set in the server's .env file (applied at
        # every start): nobody changes them here, the admin included. Its second step (MFA: CAPTCHA or email code) can be changed.
        if (data.role and data.role != ADMIN_ROLE) or data.is_active is False:
            raise _refuse("The admin account cannot be demoted or deactivated.")
        if data.password or data.email is not None:
            raise _refuse("The admin's email and password are set in the server's .env file (ADMIN_EMAIL, ADMIN_PASSWORD) and cannot be changed here.")
        data.role, data.is_active = None, None
    else:
        if data.role == ADMIN_ROLE:
            raise _refuse("Accounts cannot be promoted to admin here.")

    credentials_changed = False
    if data.password:
        problem = password_problem(data.password, username=user.username, email=str(data.email or user.email or ""))
        if problem:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=problem)
        user.password_hash = hash_password(data.password)
        credentials_changed = True
    if data.otp_mode:
        # The MFA (second sign-in step): "captcha", email code ("real") or the authenticator app ("totp"). An email code needs an address to
        # send to.
        if data.otp_mode == "real" and not (data.email or user.email):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This account has no email address, so a code cannot be sent to it.")
        if data.otp_mode != normalize_otp_mode(user.otp_mode):
            if normalize_otp_mode(user.otp_mode) == "totp":
                credentials_changed = True                # leaving the authenticator: its sessions end
            _forget_authenticator(user)                   # a different step: any authenticator secret goes, and a later setup starts fresh
        user.otp_mode = data.otp_mode
    if data.email is not None:
        email = str(data.email).strip().lower()
        if _email_taken(session, email, except_id=user.id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email address already belongs to another account")
        credentials_changed = credentials_changed or (user.email or "") != email
        user.email = email
    role_before, active_before = user.role, user.is_active
    # The location is set when the login is created and does not change. An account made before locations existed has none: it may be
    # given one, once.
    if data.location is not None and data.location != user.location:
        if user.location:
            raise _refuse("A location is set when the login is created and cannot be changed.")
        if (data.role or user.role) not in LOCATION_ROLES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The EVP and the admin see every location, so they have none.")
        user.location = data.location
    # Becoming a recruiter, recruitment manager or sales manager needs a location. (Other changes to an account that has none, such as a
    # password reset or deactivating it, are not blocked.)
    if data.role and data.role != user.role and data.role in LOCATION_ROLES and not user.location:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="This account has no location. Choose one for it (it cannot be changed afterwards).")
    if data.role:
        # Validate: if changing to non-admin, ensure email exists when using real OTP
        new_otp_mode = data.otp_mode if data.otp_mode else getattr(user, "otp_mode", "real")
        if data.role != "admin" and new_otp_mode != "captcha" and not user.email and not data.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is required for non-admin users when OTP mode is real"
            )
        user.role = data.role
        if user.role not in LOCATION_ROLES:
            user.location = None                       # the EVP and the admin see every location, so they have none
    if data.is_active is not None:
        user.is_active = data.is_active
    session.add(user)
    session.commit()
    session.refresh(user)
    if credentials_changed or (data.is_active is False):
        invalidate_user_tokens(user.username)        # sessions opened with the old password / email stop working now
    if active_before and not user.is_active:
        _switch_off_jobs(user, actor)                  # and so do the jobs they posted
    security_event("user_updated", by=actor.username, user=user.username, password_changed=bool(data.password),
                   email_changed=data.email is not None, role=user.role if user.role != role_before else None,
                   active=user.is_active if user.is_active != active_before else None)
    return _read(user)

@router.delete("/users/{user_id}", status_code=204)
def deactivate_user(user_id: str, actor: User = Depends(require_admin), session: Session = Depends(get_session)):
    """A user is never deleted: they are deactivated. They can no longer sign in, the jobs they posted in Careers stop taking applications, and
    everything that refers to them (the requirements tracker, selections, notes, history) stays exactly as it was, so a name is never reused
    by someone else. Deactivating one who is already inactive changes nothing."""
    user = session.exec(select(User).where(User.id == user_id)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == ADMIN_ROLE:
        raise _refuse("The admin account cannot be deactivated.")
    was_active = user.is_active
    if was_active:
        user.is_active = False
        session.add(user)
        session.commit()
    invalidate_user_tokens(user.username)
    jobs = _switch_off_jobs(user, actor) if was_active else 0
    security_event("user_deactivated", logging.WARNING, by=actor.username, user=user.username, jobs=jobs)
    return Response(status_code=204)
