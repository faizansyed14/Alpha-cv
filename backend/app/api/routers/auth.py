"""Authentication API routes.

Adds docstrings, import ordering, and minor formatting improvements.
Behavior remains identical.
"""


from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, or_, update as sa_update
from sqlmodel import Session, select

from app.config.settings import is_otp_email_sending_disabled, settings
from app.db.database import get_session
from app.api.deps import bearer, require_user
from app.models.user import User
from app.schemas.auth import (
    LoginRequest, MeRead, TokenResponse,
    SendOTPRequest, VerifyOTPRequest, VerifyPasswordRequest, VerifyPasswordResponse, OTPResponse,
    CaptchaRequest, CaptchaResponse, VerifyCaptchaRequest,
    TotpSetupRequest, TotpSetupResponse, VerifyTotpRequest,
)
import logging

from sqlalchemy.exc import TimeoutError as SATimeout

from app.security.auth import burn_password_check, create_access_token, revoke_token, verify_password as verify_password_hash
from app.security.logsafe import mask_email, security_event
from app.integrations.email.otp_service import get_otp_service
from app.integrations.email.email_otp_service import get_email_otp_service
from app.security.captcha import get_captcha_service
from app.security import totp as totp_factor
from app.services.auth_mode import auth_mode_for_user
from app.security.login_guard import check_lockout, record_failure, reset
from app.api.middleware.rate_limiter import rate_limiter


def _dev_codes_returned() -> bool:
    """Dev-only: return OTP/CAPTCHA answers in API responses (never in production)."""
    return settings.is_development and is_otp_email_sending_disabled()

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _find_user(session: Session, email: str) -> Optional[User]:
    """The account that signs in with this email address (any capitals), if there is one."""
    wanted = (email or "").strip().lower()
    if not wanted:
        return None
    user = session.exec(select(User).where(func.lower(User.email) == wanted)).first()
    # Give the connection back NOW: the password hash that follows takes ~0.1 s, and a flood of wrong passwords must not be able
    # to hold every pooled connection while it waits (that starved every other request). The loaded user stays readable.
    session.close()
    return user


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
def login(data: LoginRequest, request: Request, session: Session = Depends(get_session)) -> TokenResponse:
    """
    Direct password login. Only the development-only LOCAL_AUTH bypass can use it; every real account (admin
    included) goes verify-password -> CAPTCHA (/captcha, /captcha/verify) or email OTP (/send-otp, /verify-otp).
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Dev-only local auth bypass (LOCAL_AUTH=true, development environment only)
    if _local_auth_matches(data.email, data.password):
        token = create_access_token(sub=settings.LOCAL_AUTH_USERNAME, role="admin")
        return TokenResponse(
            access_token=token,
            token_type="bearer",
            username=settings.LOCAL_AUTH_USERNAME,
            role="admin",
        )
    
    # Brute-force lockout (per-username, Redis-backed)
    locked, retry_after = check_lockout(data.email, rate_limiter.get_client_ip(request))
    if locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please try again later.",
            headers={"Retry-After": str(retry_after or settings.LOGIN_LOCKOUT_SECONDS)},
        )

    # Continue with existing server-side authentication flow
    user = _find_user(session, data.email)
    # Reject unknown OR deactivated accounts (same generic message to avoid enumeration).
    if not user or not user.is_active:
        burn_password_check(data.password)
        record_failure(data.email, rate_limiter.get_client_ip(request))
        security_event("login_failed", logging.WARNING, reason="unknown_or_inactive", account=mask_email(data.email), ip=rate_limiter.get_client_ip(request))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not verify_password_hash(data.password, user.password_hash):
        record_failure(data.email, rate_limiter.get_client_ip(request))
        security_event("login_failed", logging.WARNING, reason="bad_password", account=mask_email(data.email), ip=rate_limiter.get_client_ip(request))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    reset(data.email, rate_limiter.get_client_ip(request))

    # No account may skip the second factor (admins included): the password alone never yields a token.
    logger.warning(f"Direct login attempted without a second factor: {mask_email(data.email)}")
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Second-factor verification is required. Please use the verify-password endpoint (OTP / CAPTCHA)."
    )

@router.post("/verify-password", response_model=VerifyPasswordResponse)
def verify_password_endpoint(data: VerifyPasswordRequest, request: Request, session: Session = Depends(get_session)) -> VerifyPasswordResponse:
    """
    Verify email and password.
    Returns success and whether OTP is required based on user role.
    Every account needs a second factor: the CAPTCHA or an emailed code, whichever is set for the account (its MFA).
    """
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        # Dev-only local auth bypass (LOCAL_AUTH=true, development environment only)
        if _local_auth_matches(data.email, data.password):
            logger.info("Local dev password verified (OTP not required)")
            return VerifyPasswordResponse(
                success=True,
                requires_otp=False,
                message="Password verified. Admin login successful.",
            )

        # Brute-force lockout (per-username, Redis-backed)
        locked, retry_after = check_lockout(data.email, rate_limiter.get_client_ip(request))
        if locked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed attempts. Please try again later.",
                headers={"Retry-After": str(retry_after or settings.LOGIN_LOCKOUT_SECONDS)},
            )

        # Verify user exists and password is correct
        user = _find_user(session, data.email)

        if not user or not user.is_active:
            burn_password_check(data.password)
            record_failure(data.email, rate_limiter.get_client_ip(request))
            security_event("login_failed", logging.WARNING, reason="unknown_or_inactive", account=mask_email(data.email), ip=rate_limiter.get_client_ip(request))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )

        # Verify password
        if not verify_password_hash(data.password, user.password_hash):
            record_failure(data.email, rate_limiter.get_client_ip(request))
            security_event("login_failed", logging.WARNING, reason="bad_password", account=mask_email(data.email), ip=rate_limiter.get_client_ip(request))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )

        # Success, clear the failure counter
        reset(data.email, rate_limiter.get_client_ip(request))
        
        # Every account needs a second factor; auth_mode_for_user() says which one this account uses.

        mode = auth_mode_for_user(user)  # "otp", "captcha" or "totp"
        if mode == "totp":
            enrolled = bool(user.totp_enrolled)
            logger.info(f"Password verified for {mask_email(data.email)} - authenticator code required (set up: {enrolled})")
            return VerifyPasswordResponse(
                success=True,
                requires_otp=True,
                message=("Password verified. Enter the 6-digit code from your authenticator app." if enrolled
                         else "Password verified. Set up your authenticator app to continue."),
                auth_mode="totp",
                totp_enrolled=enrolled,
            )
        if mode == "captcha":
            logger.info(f"Password verified for regular user: {mask_email(data.email)} - CAPTCHA required")
            return VerifyPasswordResponse(
                success=True,
                requires_otp=True,
                message="Password verified. Please solve the CAPTCHA.",
                auth_mode="captcha",
            )

        # Email OTP mode - email is required
        if not user.email:
            logger.error(f"Regular user {mask_email(data.email)} does not have email configured")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email not configured for user. Please contact administrator."
            )

        logger.info(f"Password verified for regular user: {mask_email(data.email)} - OTP required")
        return VerifyPasswordResponse(
            success=True,
            requires_otp=True,
            message="Password verified. OTP will be sent to your email.",
            auth_mode="otp",
        )
    
    except HTTPException:
        raise
    except SATimeout:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The server is busy. Please try again in a moment.", headers={"Retry-After": "5"})
    except Exception as e:
        logger.error(f"Error verifying password: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Something went wrong. Please try again."
        )

@router.post("/send-otp", response_model=OTPResponse)
async def send_otp(data: SendOTPRequest, request: Request, session: Session = Depends(get_session)) -> OTPResponse:
    """
    Send OTP to user's email.
    Uses stored email from user record. Verifies password first before sending OTP.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        logger.info(f"OTP send request for user: {mask_email(data.email)}")
        client_ip = rate_limiter.get_client_ip(request)
        locked, retry_after = check_lockout(data.email, client_ip)
        if locked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed attempts. Please try again later.",
                headers={"Retry-After": str(retry_after or settings.LOGIN_LOCKOUT_SECONDS)},
            )
        
        # Verify user exists and password is correct
        user = _find_user(session, data.email)
        if not user or not user.is_active:
            burn_password_check(data.password)
            record_failure(data.email, client_ip)
            security_event("login_failed", logging.WARNING, reason="otp_request_unknown_or_inactive", account=mask_email(data.email), ip=client_ip)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )
        
        # Verify password
        if not verify_password_hash(data.password, user.password_hash):
            record_failure(data.email, client_ip)
            security_event("login_failed", logging.WARNING, reason="otp_request_bad_password", account=mask_email(data.email), ip=client_ip)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )
        
        # Check if user has email configured
        if not user.email:
            logger.error(f"User {mask_email(data.email)} does not have email configured")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email not configured for user. Please contact administrator."
            )
        
        # CAPTCHA-mode users (the admin too, unless its MFA was set to email) must use the CAPTCHA flow, not email OTP.
        if auth_mode_for_user(user) == "captcha":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This account uses CAPTCHA verification. Use the CAPTCHA flow."
            )
        if auth_mode_for_user(user) == "totp":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This account uses an authenticator app. No code is emailed."
            )

        otp_service = get_otp_service()
        # Real email OTP via Azure Graph. Dev-only: OTP_DISABLE_EMAIL=1 skips sendMail and
        # returns the generated code in the response (never in production).
        skip_email = is_otp_email_sending_disabled()

        # Anti email-bomb: throttle OTP sends per username (skipped in the dev
        # no-email mode so local/CI login loops aren't blocked).
        if not skip_email:
            allowed, retry_after = otp_service.check_and_record_send(user.username)
            if not allowed:
                logger.warning(f"OTP send throttled for {user.username} (retry in {retry_after}s)")
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"An OTP was recently sent. Please wait {retry_after}s before requesting another.",
                    headers={"Retry-After": str(retry_after or 60)},
                )

        otp = otp_service.generate_otp()

        # Store OTP with username (using stored email)
        otp_service.store_otp(email=user.email, otp=otp, username=user.username)

        if skip_email:
            email_sent = True  # Dev: do not actually email
            logger.info(f"OTP email disabled (dev): not sending email for {mask_email(data.email)}")
        else:
            email_otp_service = get_email_otp_service()
            logger.info(f"Sending OTP to {mask_email(user.email)} for user {mask_email(data.email)}")
            email_sent = await email_otp_service.send_otp_email(
                to_email=user.email,
                otp=otp,
                username=user.username
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
            
            logger.info(f"OTP sent successfully to {mask_email(user.email)} for user {mask_email(data.email)}")
            return OTPResponse(
                message=f"OTP sent successfully",
                success=True,
                masked_email=masked_email,
                dev_otp=(otp if _dev_codes_returned() else None),
            )
        else:
            logger.error(f"Failed to send OTP email to {mask_email(user.email)} for user {mask_email(data.email)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send OTP email. Please check Azure email configuration. See backend logs for details."
            )
    
    except HTTPException:
        raise
    except SATimeout:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The server is busy. Please try again in a moment.", headers={"Retry-After": "5"})
    except Exception as e:
        logger.error(f"Error sending OTP: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Something went wrong. Please try again."
        )

@router.post("/verify-otp", response_model=TokenResponse)
async def verify_otp(data: VerifyOTPRequest, request: Request, session: Session = Depends(get_session)) -> TokenResponse:
    """
    Verify OTP and login user.
    Requires username and OTP. Email is retrieved from user record.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        logger.info(f"OTP verification request for user: {mask_email(data.email)}")
        
        # Find user by username
        user = _find_user(session, data.email)
        if not user or not user.is_active:
            logger.warning(f"User not found or inactive: {mask_email(data.email)}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired OTP"
            )
        
        # Get user's email
        if not user.email:
            logger.error(f"User {mask_email(data.email)} does not have email configured")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email not configured for user"
            )
        
        otp_service = get_otp_service()
        
        # Verify OTP using user's email
        is_valid, stored_username = otp_service.verify_otp(email=user.email, otp=data.otp)
        
        if not is_valid:
            security_event("login_failed", logging.WARNING, reason="bad_otp", account=mask_email(data.email), ip=rate_limiter.get_client_ip(request))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired OTP"
            )
        
        # Verify username matches
        if stored_username != user.username:
            logger.warning(f"Username mismatch: expected {user.username}, got {stored_username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid OTP"
            )
        
        # Create access token
        token = create_access_token(sub=user.username, role=user.role)
        security_event("login_ok", factor="otp", user=user.username, role=user.role, ip=rate_limiter.get_client_ip(request))
        return TokenResponse(
            access_token=token,
            token_type="bearer",
            username=user.username,
            role=user.role
        )
    
    except HTTPException:
        raise
    except SATimeout:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The server is busy. Please try again in a moment.", headers={"Retry-After": "5"})
    except Exception as e:
        logger.error(f"Error verifying OTP: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Something went wrong. Please try again."
        )

@router.post("/captcha", response_model=CaptchaResponse)
def get_captcha(data: CaptchaRequest, request: Request, session: Session = Depends(get_session)) -> CaptchaResponse:
    """Issue an image CAPTCHA challenge for a CAPTCHA-mode user (after password check).

    The frontend calls this after verify-password (and again for the "refresh" button).
    """
    import logging
    logger = logging.getLogger(__name__)

    # Brute-force lockout (shared with password attempts)
    locked, retry_after = check_lockout(data.email, rate_limiter.get_client_ip(request))
    if locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please try again later.",
            headers={"Retry-After": str(retry_after or settings.LOGIN_LOCKOUT_SECONDS)},
        )

    user = _find_user(session, data.email)
    if not user or not user.is_active:
        burn_password_check(data.password)
    if not user or not user.is_active or not verify_password_hash(data.password, user.password_hash):
        record_failure(data.email, rate_limiter.get_client_ip(request))
        security_event("login_failed", logging.WARNING, reason="captcha_request_bad_credentials", account=mask_email(data.email), ip=rate_limiter.get_client_ip(request))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if auth_mode_for_user(user) != "captcha":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This account does not use the CAPTCHA")

    reset(data.email, rate_limiter.get_client_ip(request))
    try:
        challenge = get_captcha_service().create_challenge(user.username, data.fingerprint)
    except PermissionError as pe:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many CAPTCHA requests. Please wait a moment.",
            headers={"Retry-After": str(pe)},
        )
    logger.info(f"CAPTCHA issued for user {mask_email(data.email)}")
    return CaptchaResponse(
        success=True,
        captcha_id=challenge["captcha_id"],
        image=challenge["image"],
        expires_in=challenge["expires_in"],
        dev_code=(get_captcha_service().peek_code(challenge["captcha_id"]) if _dev_codes_returned() else None),
    )


@router.post("/captcha/verify", response_model=TokenResponse)
def verify_captcha(data: VerifyCaptchaRequest, request: Request, session: Session = Depends(get_session)) -> TokenResponse:
    """Verify an image CAPTCHA answer and log the user in."""
    import logging
    logger = logging.getLogger(__name__)

    locked, retry_after = check_lockout(data.email, rate_limiter.get_client_ip(request))
    if locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please try again later.",
            headers={"Retry-After": str(retry_after or settings.LOGIN_LOCKOUT_SECONDS)},
        )

    user = _find_user(session, data.email)
    if not user or not user.is_active:
        # same answer as a wrong CAPTCHA: this endpoint must not tell whether an email is registered
        record_failure(data.email, rate_limiter.get_client_ip(request))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired CAPTCHA")

    ok = get_captcha_service().verify(
        captcha_id=data.captcha_id, answer=data.answer,
        username=user.username, fingerprint=data.fingerprint,
    )
    if not ok:
        record_failure(data.email, rate_limiter.get_client_ip(request))
        security_event("login_failed", logging.WARNING, reason="bad_captcha", account=mask_email(data.email), ip=rate_limiter.get_client_ip(request))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired CAPTCHA")

    reset(data.email, rate_limiter.get_client_ip(request))
    token = create_access_token(sub=user.username, role=user.role)
    security_event("login_ok", factor="captcha", user=user.username, role=user.role, ip=rate_limiter.get_client_ip(request))
    return TokenResponse(access_token=token, token_type="bearer", username=user.username, role=user.role)


def _totp_account(session: Session, request: Request, email: str, password: str, step: str) -> User:
    """The account for an authenticator request: not locked out, the password is right and the account uses the authenticator.
    The same lockout and the same generic answers as every other sign-in step."""
    client_ip = rate_limiter.get_client_ip(request)
    locked, retry_after = check_lockout(email, client_ip)
    if locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please try again later.",
            headers={"Retry-After": str(retry_after or settings.LOGIN_LOCKOUT_SECONDS)},
        )
    user = _find_user(session, email)
    if not user or not user.is_active:
        burn_password_check(password)
    if not user or not user.is_active or not verify_password_hash(password, user.password_hash):
        record_failure(email, client_ip)
        security_event("login_failed", logging.WARNING, reason=f"totp_{step}_bad_credentials", account=mask_email(email), ip=client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if auth_mode_for_user(user) != "totp":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This account does not use an authenticator app")
    return user


@router.post("/totp/setup", response_model=TotpSetupResponse)
def totp_setup(data: TotpSetupRequest, request: Request, session: Session = Depends(get_session)) -> TotpSetupResponse:
    """The QR code for setting up the authenticator app (after the password check), shown at the first sign-in of an account on the
    authenticator. Asking again before the first code is accepted shows the same QR code, so a refresh does not invalidate a scan.
    Once the setup is finished this refuses: only the admin can reset an account (Users page), e.g. after a lost phone."""
    user = _totp_account(session, request, data.email, data.password, "setup")
    if user.totp_enrolled:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="The authenticator app is already set up. If you lost it, ask the administrator to reset it.")
    secret = totp_factor.decrypt_secret(user.totp_secret)
    if not secret:
        secret = totp_factor.new_secret()
        # only the first of two simultaneous requests stores its secret; the other shows that one
        session.execute(sa_update(User).where(User.id == user.id, or_(User.totp_secret.is_(None), User.totp_secret == user.totp_secret))
                        .where(User.totp_enrolled.is_(False)).values(totp_secret=totp_factor.encrypt_secret(secret)))
        session.commit()
        stored = session.exec(select(User.totp_secret).where(User.id == user.id)).first()
        secret = totp_factor.decrypt_secret(stored) or secret
    account = user.email or user.username
    security_event("totp_setup_shown", user=user.username, ip=rate_limiter.get_client_ip(request))
    return TotpSetupResponse(
        success=True,
        qr=totp_factor.qr_data_url(totp_factor.provisioning_uri(secret, account)),
        secret=totp_factor.grouped(secret),
        issuer=settings.TOTP_ISSUER,
        account=account,
    )


@router.post("/totp/verify", response_model=TokenResponse)
def verify_totp(data: VerifyTotpRequest, request: Request, session: Session = Depends(get_session)) -> TokenResponse:
    """Check the 6-digit code from the authenticator app and sign the user in. The first correct code also finishes the setup.
    A code works once (its time step is recorded), and wrong codes count towards the same lockout as wrong passwords."""
    client_ip = rate_limiter.get_client_ip(request)
    user = _totp_account(session, request, data.email, data.password, "verify")
    secret = totp_factor.decrypt_secret(user.totp_secret)
    if not secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The authenticator app is not set up yet. Start the setup first.")
    step = totp_factor.matching_step(secret, data.code)
    accepted = False
    if step is not None:
        # atomic: of two requests with the same code only one changes a row, the other is a replay
        result = session.execute(sa_update(User).where(User.id == user.id, or_(User.totp_last_step.is_(None), User.totp_last_step < step))
                                 .values(totp_last_step=step, totp_enrolled=True))
        session.commit()
        accepted = result.rowcount == 1
    if not accepted:
        record_failure(data.email, client_ip)
        security_event("login_failed", logging.WARNING, reason="bad_totp" if step is None else "totp_replayed", account=mask_email(data.email), ip=client_ip)
        if step is not None:
            # The code is right but was already used (the app shows the same 6 digits for up to 30 seconds): say so, so nobody thinks the
            # setup is broken. Only someone who knows the password can see this answer, and a used code is worth nothing to them.
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="That code was already used. Wait for the next code (it changes every 30 seconds) and enter the new one.")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired code")

    reset(data.email, client_ip)
    token = create_access_token(sub=user.username, role=user.role)
    if not user.totp_enrolled:
        security_event("totp_enrolled", user=user.username, ip=client_ip)
    security_event("login_ok", factor="totp", user=user.username, role=user.role, ip=client_ip)
    return TokenResponse(access_token=token, token_type="bearer", username=user.username, role=user.role)


@router.get("/me", response_model=MeRead)
def get_me(user: User = Depends(require_user)) -> MeRead:
    return MeRead(id=user.id, username=user.username, role=user.role, is_active=user.is_active, location=getattr(user, "location", None))


@router.post("/logout")
def logout(user: User = Depends(require_user), token: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    """Revoke the token this request was made with (it stops working now, not at expiry) and clear the caller's
    online-presence marker so the admin page shows them offline immediately."""
    import app.services.presence as presence
    revoke_token(token.credentials)
    presence.clear(user.username)
    security_event("logout", user=user.username)
    return {"success": True}
