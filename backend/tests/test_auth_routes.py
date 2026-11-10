"""
Comprehensive tests for authentication routes (app/api/routers/auth.py)

Tests cover:
- Login endpoint (admin and regular users)
- Password verification
- OTP sending and verification
- Token generation
- Error handling
"""
import pytest
from unittest.mock import patch
from fastapi import status
from app.models.user import User
from app.security.auth import hash_password, create_access_token


@pytest.mark.integration
@pytest.mark.auth
class TestLoginEndpoint:
    """Test the /api/auth/login endpoint."""
    
    def test_login_admin_user_needs_second_factor(self, test_client, db_session):
        """The password alone never yields a token, not even for the admin."""
        db_session.add(User(username="admin", password_hash=hash_password("admin123"), email="admin@example.com",
                            role="admin", is_active=True))
        db_session.commit()

        response = test_client.post("/api/auth/login", json={"email": "admin@example.com", "password": "admin123"})

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "access_token" not in response.json()

    def test_login_regular_user_forbidden(self, test_client, db_session):
        """Test that regular users cannot use direct login."""
        # Add regular user to database
        regular_user = User(
            username="user1",
            password_hash=hash_password("user123"),
            email="user1@example.com",
            role="user",
            is_active=True
        )
        db_session.add(regular_user)
        db_session.commit()
        
        response = test_client.post(
            "/api/auth/login",
            json={"email": "user1@example.com", "password": "user123"}
        )
        
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "OTP" in response.json()["detail"]
    
    def test_login_invalid_credentials(self, test_client, db_session):
        """Test login with invalid credentials."""
        response = test_client.post(
            "/api/auth/login",
            json={"email": "nobody@example.com", "password": "wrong"}
        )
        
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
    
    def test_login_inactive_user(self, test_client, db_session):
        """Test login with inactive user."""
        inactive_user = User(
            username="inactive",
            password_hash=hash_password("pass123"),
            email="inactive@example.com",
            role="admin",
            is_active=False
        )
        db_session.add(inactive_user)
        db_session.commit()
        
        response = test_client.post(
            "/api/auth/login",
            json={"email": "inactive@example.com", "password": "pass123"}
        )
        
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.integration
@pytest.mark.auth
class TestVerifyPasswordEndpoint:
    """Test the /api/auth/verify-password endpoint."""
    
    def test_verify_password_admin_user_requires_captcha(self, test_client, db_session):
        """Admins get the CAPTCHA step (no email needed), and can complete the flow that issues the CAPTCHA."""
        db_session.add(User(username="admin", password_hash=hash_password("admin123"), email="admin@example.com", role="admin", is_active=True))
        db_session.commit()

        response = test_client.post("/api/auth/verify-password", json={"email": "admin@example.com", "password": "admin123"})

        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["success"] is True and data["requires_otp"] is True and data["auth_mode"] == "captcha"

        # the CAPTCHA endpoint no longer turns admins away
        challenge = test_client.post("/api/auth/captcha", json={"email": "admin@example.com", "password": "admin123"})
        assert challenge.status_code == status.HTTP_200_OK and challenge.json()["captcha_id"]

    def test_verify_password_regular_user(self, test_client, db_session):
        """Test password verification for regular user (OTP required)."""
        regular_user = User(
            username="user1",
            password_hash=hash_password("user123"),
            email="user1@example.com",
            role="user",
            is_active=True
        )
        db_session.add(regular_user)
        db_session.commit()
        
        response = test_client.post(
            "/api/auth/verify-password",
            json={"email": "user1@example.com", "password": "user123"}
        )
        
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["success"] is True
        assert data["requires_otp"] is True
        assert "access_token" not in data
    
    def test_verify_password_invalid_credentials(self, test_client, db_session):
        """Test password verification with invalid credentials."""
        response = test_client.post(
            "/api/auth/verify-password",
            json={"email": "nobody@example.com", "password": "wrong"}
        )
        
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
    
    def test_verify_password_ignores_capitals_and_spaces_in_the_email(self, test_client, db_session):
        db_session.add(User(username="user1", password_hash=hash_password("user123"), email="user1@example.com", role="user", is_active=True))
        db_session.commit()

        response = test_client.post("/api/auth/verify-password", json={"email": "  User1@Example.COM ", "password": "user123"})

        assert response.status_code == status.HTTP_200_OK and response.json()["success"] is True

    def test_the_username_is_not_a_way_to_sign_in(self, test_client, db_session):
        """The username is only the name shown in the app: typing it where the email goes is a failed sign-in."""
        db_session.add(User(username="user1", password_hash=hash_password("user123"), email="user1@example.com", role="user", is_active=True))
        db_session.commit()

        response = test_client.post("/api/auth/verify-password", json={"email": "user1", "password": "user123"})

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert test_client.post("/api/auth/verify-password", json={"username": "user1", "password": "user123"}).status_code == 422

    def test_an_account_without_an_email_cannot_be_signed_in_to(self, test_client, db_session):
        db_session.add(User(username="noemail", password_hash=hash_password("pass123"), email=None, role="user", is_active=True))
        db_session.commit()

        for typed in ("", "noemail", "None"):
            response = test_client.post("/api/auth/verify-password", json={"email": typed, "password": "pass123"})
            assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.integration
@pytest.mark.auth
class TestSendOTPEndpoint:
    """Test the /api/auth/send-otp endpoint."""
    
    @pytest.mark.asyncio
    async def test_send_otp_success(self, test_client, db_session, mock_otp_service, mock_email_service):
        """Test successful OTP sending."""
        regular_user = User(
            username="user1",
            password_hash=hash_password("user123"),
            email="user1@example.com",
            role="user",
            is_active=True
        )
        db_session.add(regular_user)
        db_session.commit()
        
        with patch('app.api.routers.auth.get_otp_service', return_value=mock_otp_service), \
             patch('app.api.routers.auth.get_email_otp_service', return_value=mock_email_service):
            
            mock_otp_service.generate_otp.return_value = "123456"
            mock_otp_service.store_otp.return_value = None
            # Mock async email service
            async def async_send_email(*args, **kwargs):
                return True
            mock_email_service.send_otp_email = async_send_email
            
            response = test_client.post(
                "/api/auth/send-otp",
                json={"email": "user1@example.com", "password": "user123"}
            )
        
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["success"] is True
        assert "masked_email" in data
        assert "@" in data["masked_email"]
    
    def test_send_otp_user_not_found(self, test_client, db_session):
        """Test OTP sending for non-existent user."""
        # send-otp requires password field
        response = test_client.post(
            "/api/auth/send-otp",
            json={"email": "nobody@example.com", "password": "wrong"}
        )
        
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.integration
@pytest.mark.auth
class TestVerifyOTPEndpoint:
    """Test the /api/auth/verify-otp endpoint."""
    
    @pytest.mark.asyncio
    async def test_verify_otp_success(self, test_client, db_session, mock_otp_service):
        """Test successful OTP verification."""
        regular_user = User(
            username="user1",
            password_hash=hash_password("user123"),
            email="user1@example.com",
            role="user",
            is_active=True
        )
        db_session.add(regular_user)
        db_session.commit()
        
        with patch('app.api.routers.auth.get_otp_service', return_value=mock_otp_service):
            mock_otp_service.verify_otp.return_value = (True, "user1")
            
            response = test_client.post(
                "/api/auth/verify-otp",
                json={"email": "user1@example.com", "otp": "123456"}
            )
        
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["username"] == "user1"
    
    @pytest.mark.asyncio
    async def test_verify_otp_invalid(self, test_client, db_session, mock_otp_service):
        """Test OTP verification with invalid OTP."""
        regular_user = User(
            username="user1",
            password_hash=hash_password("user123"),
            email="user1@example.com",
            role="user",
            is_active=True
        )
        db_session.add(regular_user)
        db_session.commit()
        
        with patch('app.api.routers.auth.get_otp_service', return_value=mock_otp_service):
            mock_otp_service.verify_otp.return_value = (False, None)  # Invalid OTP
            
            response = test_client.post(
                "/api/auth/verify-otp",
                json={"email": "user1@example.com", "otp": "wrong123"}
            )
        
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert "invalid" in response.json()["detail"].lower()
    
    def test_verify_otp_user_not_found(self, test_client, db_session):
        """An unknown user gets the same answer as a wrong code, so the endpoint cannot be used to list usernames."""
        response = test_client.post(
            "/api/auth/verify-otp",
            json={"email": "nobody@example.com", "otp": "123456"}
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["detail"] == "Invalid or expired OTP"


@pytest.mark.integration
@pytest.mark.auth
class TestGetCurrentUserEndpoint:
    """Test the /api/auth/me endpoint."""
    
    def test_get_current_user_success(self, test_client, db_session):
        """Test getting current user information."""
        user = User(
            username="user1",
            password_hash=hash_password("user123"),
            email="user1@example.com",
            role="user",
            is_active=True
        )
        db_session.add(user)
        db_session.commit()
        
        # Create a valid token
        token = create_access_token("user1", "user")
        
        response = test_client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["username"] == "user1"
        assert data["role"] == "user"
        assert "email" not in data and set(data) == {"id", "username", "role", "is_active"}      # the email is not sent back
    
    def test_get_current_user_unauthorized(self, test_client):
        """Test getting current user without token."""
        response = test_client.get("/api/auth/me")
        
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
