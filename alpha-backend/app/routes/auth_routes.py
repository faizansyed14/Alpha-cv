"""Authentication API routes.

Adds docstrings, import ordering, and minor formatting improvements.
Behavior remains identical.
"""

import os
import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.core.config import is_otp_email_sending_disabled, settings
from app.db.auth_db import get_session
from app.deps.auth import require_user
from app.models.user import User
from app.schemas.auth import (
    LoginRequest, TokenResponse, UserRead,
    SendOTPRequest, VerifyOTPRequest, VerifyPasswordRequest, VerifyPasswordResponse, OTPResponse,
    CaptchaRequest, CaptchaResponse, VerifyCaptchaRequest,
)
from app.utils.security import create_access_token, verify_password as verify_password_hash
from app.services.email.otp_service import get_otp_service
from app.services.email.email_otp_service import get_email_otp_service
from app.services.captcha_service import get_captcha_service
from app.services.auth_mode import auth_mode_for_user
from app.services.login_guard import check_lockout, record_failure, reset


def _dev_codes_returned() -> bool:
    """Dev-only: return OTP/CAPTCHA answers in API responses (never in production)."""
    return settings.is_development and is_otp_email_sending_disabled()

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _local_auth_matches(username: str, password: str) -> bool:
    """True only when the dev-only LOCAL_AUTH bypass is enabled and matches."""
    return (
        settings.LOCAL_AUTH
        and settings.is_development
        and bool(settings.LOCAL_AUTH_USERNAME)
        and bool(settings.LOCAL_AUTH_PASSWORD)
        and username == settings.LOCAL_AUTH_USERNAME
        and password == settings.LOCAL_AUTH_PASSWORD
    )

@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, session: Session = Depends(get_session)) -> TokenResponse:
    """
    Direct login endpoint (for admin users or legacy support).
    For regular users, use verify-password -> send-otp -> verify-otp flow.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Dev-only local auth bypass (LOCAL_AUTH=true, development environment only)
    if _local_auth_matches(data.username, data.password):
        token = create_access_token(sub=settings.LOCAL_AUTH_USERNAME, role="admin")
        return TokenResponse(
            access_token=token,
            token_type="bearer",
            username=settings.LOCAL_AUTH_USERNAME,
            role="admin",
        )
    
    # Brute-force lockout (per-username, Redis-backed)
    locked, retry_after = check_lockout(data.username)
    if locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please try again later.",
            headers={"Retry-After": str(retry_after or settings.LOGIN_LOCKOUT_SECONDS)},
        )

    # Continue with existing server-side authentication flow
    user = session.exec(select(User).where(User.username == data.username)).first()
    # Reject unknown OR deactivated accounts (same generic message to avoid enumeration).
    if not user or not user.is_active:
        record_failure(data.username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not verify_password_hash(data.password, user.password_hash):
        record_failure(data.username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    reset(data.username)

    # Only allow direct login for admin users
    if user.role != "admin":
        logger.warning(f"⚠️ Direct login attempted for non-admin user: {data.username}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Regular users must use OTP authentication. Please use the verify-password endpoint."
        )
    
    token = create_access_token(sub=user.username, role=user.role)
    logger.info(f"✅ Direct login successful for admin user: {user.username}")
    return TokenResponse(access_token=token, token_type="bearer", username=user.username, role=user.role)

@router.post("/verify-password", response_model=VerifyPasswordResponse)
def verify_password_endpoint(data: VerifyPasswordRequest, session: Session = Depends(get_session)) -> VerifyPasswordResponse:
    """
    Verify username and password.
    Returns success and whether OTP is required based on user role.
    - Admin users: requires_otp = False (login directly)
    - Regular users: requires_otp = True (need OTP)
    """
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        # Dev-only local auth bypass (LOCAL_AUTH=true, development environment only)
        if _local_auth_matches(data.username, data.password):
            logger.info("✅ Local dev password verified (OTP not required)")
            return VerifyPasswordResponse(
                success=True,
                requires_otp=False,
                message="Password verified. Admin login successful.",
            )

        # Brute-force lockout (per-username, Redis-backed)
        locked, retry_after = check_lockout(data.username)
        if locked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed attempts. Please try again later.",
                headers={"Retry-After": str(retry_after or settings.LOGIN_LOCKOUT_SECONDS)},
            )

        # Verify user exists and password is correct
        user = session.exec(select(User).where(User.username == data.username)).first()

        if not user or not user.is_active:
            record_failure(data.username)
            logger.warning("❌ Failed password verification (unknown/inactive user)")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )

        # Verify password
        if not verify_password_hash(data.password, user.password_hash):
            record_failure(data.username)
            logger.warning("❌ Failed password verification (bad password)")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )

        # Success — clear the failure counter
        reset(data.username)
        
        # Check if user is admin (skip second factor) or regular user
        if user.role == "admin":
            logger.info(f"✅ Password verified for admin user: {data.username} - no second factor")
            return VerifyPasswordResponse(
                success=True,
                requires_otp=False,
                message="Password verified. Admin login successful.",
                auth_mode="none",
            )

        mode = auth_mode_for_user(user)  # "otp" or "captcha"
        if mode == "captcha":
            logger.info(f"✅ Password verified for regular user: {data.username} - CAPTCHA required")
            return VerifyPasswordResponse(
                success=True,
                requires_otp=True,
                message="Password verified. Please solve the CAPTCHA.",
                auth_mode="captcha",
            )

        # Email OTP mode - email is required
        if not user.email:
            logger.error(f"❌ Regular user {data.username} does not have email configured")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email not configured for user. Please contact administrator."
            )

        logger.info(f"✅ Password verified for regular user: {data.username} - OTP required")
        return VerifyPasswordResponse(
            success=True,
            requires_otp=True,
            message="Password verified. OTP will be sent to your email.",
            auth_mode="otp",
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error verifying password: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error verifying password: {str(e)}"
        )

@router.post("/send-otp", response_model=OTPResponse)
async def send_otp(data: SendOTPRequest, session: Session = Depends(get_session)) -> OTPResponse:
    """
    Send OTP to user's email.
    Uses stored email from user record. Verifies password first before sending OTP.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        logger.info(f"📧 OTP send request for user: {data.username}")
        
        # Verify user exists and password is correct
        user = session.exec(select(User).where(User.username == data.username)).first()
        if not user or not user.is_active:
            logger.warning(f"❌ User not found or inactive for OTP request: {data.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )
        
        # Verify password
        if not verify_password_hash(data.password, user.password_hash):
            logger.warning(f"❌ Invalid password for OTP request for user: {data.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )
        
        # Check if user has email configured
        if not user.email:
            logger.error(f"❌ User {data.username} does not have email configured")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email not configured for user. Please contact administrator."
            )
        
        # Admin users should not need OTP (this should not be called for admin, but check anyway)
        if user.role == "admin":
            logger.warning(f"⚠️ OTP requested for admin user {data.username} - this should not happen")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Admin users do not require OTP"
            )
        
        # CAPTCHA-mode users must use the CAPTCHA flow, not email OTP.
        if auth_mode_for_user(user) == "captcha":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This account uses CAPTCHA verification. Use the CAPTCHA flow."
            )

        otp_service = get_otp_service()
        # Real email OTP via Azure Graph. Dev-only: OTP_DISABLE_EMAIL=1 skips sendMail and
        # returns the generated code in the response (never in production).
        skip_email = is_otp_email_sending_disabled()

        # Anti email-bomb: throttle OTP sends per username (skipped in the dev
        # no-email mode so local/CI login loops aren't blocked).
        if not skip_email:
            allowed, retry_after = otp_service.check_and_record_send(data.username)
            if not allowed:
                logger.warning(f"⏳ OTP send throttled for {data.username} (retry in {retry_after}s)")
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"An OTP was recently sent. Please wait {retry_after}s before requesting another.",
                    headers={"Retry-After": str(retry_after or 60)},
                )

        otp = otp_service.generate_otp()

        # Store OTP with username (using stored email)
        otp_service.store_otp(email=user.email, otp=otp, username=data.username)

        if skip_email:
            email_sent = True  # Dev: do not actually email
            logger.info(f"📧 OTP email disabled (dev): not sending email for {data.username}")
        else:
            email_otp_service = get_email_otp_service()
            logger.info(f"📧 Sending OTP to {user.email} for user {data.username}")
            email_sent = await email_otp_service.send_otp_email(
                to_email=user.email,
                otp=otp,
                username=data.username
            )

        if email_sent:
            # Mask email for display (e.g., "syed****@example.com")
            email_parts = user.email.split('@')
            if len(email_parts) == 2:
                local_part = email_parts[0]
                domain = email_parts[1]
                # Show first 4 characters, then mask the rest
                if len(local_part) > 4:
                    masked_local = local_part[:4] + '****'
                else:
                    masked_local = local_part[0] + '****'
                masked_email = f"{masked_local}@{domain}"
            else:
                masked_email = user.email  # Fallback if email format is unexpected
            
            logger.info(f"✅ OTP sent successfully to {user.email} for user {data.username}")
            return OTPResponse(
                message=f"OTP sent successfully",
                success=True,
                masked_email=masked_email,
                dev_otp=(otp if _dev_codes_returned() else None),
            )
        else:
            logger.error(f"❌ Failed to send OTP email to {user.email} for user {data.username}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send OTP email. Please check Azure email configuration. See backend logs for details."
            )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error sending OTP: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error sending OTP: {str(e)}"
        )

@router.post("/verify-otp", response_model=TokenResponse)
async def verify_otp(data: VerifyOTPRequest, session: Session = Depends(get_session)) -> TokenResponse:
    """
    Verify OTP and login user.
    Requires username and OTP. Email is retrieved from user record.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        logger.info(f"🔑 OTP verification request for user: {data.username}")
        
        # Find user by username
        user = session.exec(select(User).where(User.username == data.username)).first()
        if not user or not user.is_active:
            logger.warning(f"❌ User not found or inactive: {data.username}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found or inactive"
            )
        
        # Get user's email
        if not user.email:
            logger.error(f"❌ User {data.username} does not have email configured")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email not configured for user"
            )
        
        otp_service = get_otp_service()
        
        # Verify OTP using user's email
        is_valid, stored_username = otp_service.verify_otp(email=user.email, otp=data.otp)
        
        if not is_valid:
            logger.warning(f"❌ Invalid or expired OTP for user: {data.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired OTP"
            )
        
        # Verify username matches
        if stored_username != data.username:
            logger.warning(f"❌ Username mismatch: expected {data.username}, got {stored_username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid OTP"
            )
        
        # Create access token
        token = create_access_token(sub=user.username, role=user.role)
        logger.info(f"✅ OTP verified and user logged in: {user.username} ({user.role})")
        return TokenResponse(
            access_token=token,
            token_type="bearer",
            username=user.username,
            role=user.role
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error verifying OTP: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error verifying OTP: {str(e)}"
        )

@router.post("/captcha", response_model=CaptchaResponse)
def get_captcha(data: CaptchaRequest, session: Session = Depends(get_session)) -> CaptchaResponse:
    """Issue an image CAPTCHA challenge for a CAPTCHA-mode user (after password check).

    The frontend calls this after verify-password (and again for the "refresh" button).
    """
    import logging
    logger = logging.getLogger(__name__)

    # Brute-force lockout (shared with password attempts)
    locked, retry_after = check_lockout(data.username)
    if locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please try again later.",
            headers={"Retry-After": str(retry_after or settings.LOGIN_LOCKOUT_SECONDS)},
        )

    user = session.exec(select(User).where(User.username == data.username)).first()
    if not user or not user.is_active or not verify_password_hash(data.password, user.password_hash):
        record_failure(data.username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if user.role == "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admin users do not require CAPTCHA")
    if auth_mode_for_user(user) != "captcha":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This account uses email OTP, not CAPTCHA")

    reset(data.username)
    try:
        challenge = get_captcha_service().create_challenge(data.username, data.fingerprint)
    except PermissionError as pe:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many CAPTCHA requests. Please wait a moment.",
            headers={"Retry-After": str(pe)},
        )
    logger.info(f"🧩 CAPTCHA issued for user {data.username}")
    return CaptchaResponse(
        success=True,
        captcha_id=challenge["captcha_id"],
        image=challenge["image"],
        expires_in=challenge["expires_in"],
        dev_code=(get_captcha_service().peek_code(challenge["captcha_id"]) if _dev_codes_returned() else None),
    )


@router.post("/captcha/verify", response_model=TokenResponse)
def verify_captcha(data: VerifyCaptchaRequest, session: Session = Depends(get_session)) -> TokenResponse:
    """Verify an image CAPTCHA answer and log the user in."""
    import logging
    logger = logging.getLogger(__name__)

    locked, retry_after = check_lockout(data.username)
    if locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please try again later.",
            headers={"Retry-After": str(retry_after or settings.LOGIN_LOCKOUT_SECONDS)},
        )

    user = session.exec(select(User).where(User.username == data.username)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found or inactive")

    ok = get_captcha_service().verify(
        captcha_id=data.captcha_id, answer=data.answer,
        username=data.username, fingerprint=data.fingerprint,
    )
    if not ok:
        record_failure(data.username)
        logger.warning(f"❌ Invalid/expired CAPTCHA for user: {data.username}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired CAPTCHA")

    reset(data.username)
    token = create_access_token(sub=user.username, role=user.role)
    logger.info(f"✅ CAPTCHA verified and user logged in: {user.username} ({user.role})")
    return TokenResponse(access_token=token, token_type="bearer", username=user.username, role=user.role)


@router.get("/me", response_model=UserRead)
def get_me(user: User = Depends(require_user)) -> UserRead:
    return UserRead(id=user.id, username=user.username, role=user.role, is_active=user.is_active, email=user.email)


@router.post("/logout")
def logout(user: User = Depends(require_user)) -> dict:
    """Clear the caller's online-presence marker so the admin page shows them
    offline immediately. JWTs remain valid until expiry (stateless auth)."""
    import app.services.presence as presence
    presence.clear(user.username)
    return {"success": True}
