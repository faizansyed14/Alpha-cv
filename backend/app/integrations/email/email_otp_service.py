"""Email OTP Service - Send OTP emails via Microsoft Graph API.

Uses the same Azure authentication as the email processing service.
"""

import html
import logging
import aiohttp
from typing import Optional

from app.config.settings import settings, get_otp_from_email

logger = logging.getLogger(__name__)

BRAND = "AlphaData Recruitment"
# The application's own colours (frontend/src/app/globals.css): the navy of buttons and the sign-in panel, the page grey, the hairline.
_NAVY, _INK, _TEXT, _MUTED, _CANVAS, _LINE, _TINT = "#16204B", "#0F172A", "#475569", "#94A3B8", "#F4F6FA", "#E2E7F0", "#F5F7FB"
_FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"


def otp_email_html(otp: str, username: Optional[str] = None, minutes: int = 5) -> str:
    """The sign-in code email. Written the way mail programs need it: tables for layout, every style inline, no pictures or web fonts
    (most programs block remote pictures until the reader allows them, so the brand is plain text), and it reads the same in Outlook,
    Gmail and on a phone. The code is one run of text, so a tap or double-click selects all of it."""
    name = html.escape(str(username).strip()) if username and str(username).strip() else ""
    code = html.escape(str(otp))
    life = f"{minutes} minute{'s' if minutes != 1 else ''}"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Your sign-in code</title>
</head>
<body style="margin:0; padding:0; background-color:{_CANVAS}; -webkit-text-size-adjust:100%;">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:{_CANVAS}; font-size:1px; line-height:1px;">Use this code to finish signing in. It expires in {life}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{_CANVAS}" style="background-color:{_CANVAS};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td bgcolor="{_NAVY}" style="background-color:{_NAVY}; border-radius:16px 16px 0 0; padding:22px 32px; font-family:{_FONT};">
            <span style="font-size:17px; font-weight:600; letter-spacing:-0.2px; color:#FFFFFF;">AlphaData</span>
            <span style="font-size:11px; font-weight:600; letter-spacing:2.4px; text-transform:uppercase; color:#A4B0CC; padding-left:10px;">Recruitment</span>
          </td>
        </tr>
        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF; border:1px solid {_LINE}; border-top:0; border-radius:0 0 16px 16px; padding:36px 32px 32px; font-family:{_FONT};">
            <h1 style="margin:0 0 10px; font-size:22px; line-height:28px; font-weight:600; letter-spacing:-0.4px; color:{_INK};">Your sign-in code</h1>
            <p style="margin:0 0 26px; font-size:15px; line-height:24px; color:{_TEXT};">{f'Hi {name}, use' if name else 'Use'} this code to finish signing in.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="{_TINT}" style="background-color:{_TINT}; border:1px solid #CDD4E6; border-radius:12px; padding:22px 12px;">
                  <span style="font-family:'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-size:34px; line-height:40px; font-weight:700; letter-spacing:10px; color:{_NAVY}; padding-left:10px;">{code}</span>
                </td>
              </tr>
            </table>
            <p style="margin:22px 0 0; font-size:14px; line-height:22px; color:{_TEXT};">The code expires in <strong style="color:{_INK}; font-weight:600;">{life}</strong>. Do not share it with anyone.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="padding:26px 0 0;"><div style="border-top:1px solid {_LINE}; font-size:0; line-height:0;">&nbsp;</div></td></tr>
            </table>
            <p style="margin:20px 0 0; font-size:13px; line-height:20px; color:#64748B;">Did not try to sign in? You can ignore this email. Nobody can sign in without this code.</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:22px 16px 0; font-family:{_FONT}; font-size:12px; line-height:18px; color:{_MUTED};">
            This is an automated message from {BRAND}. Please do not reply to it.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>"""


class EmailOTPService:
    """Service for sending OTP emails via Microsoft Graph API."""
    
    def __init__(self):
        # Azure App Registration credentials (no placeholder defaults; unset means
        # the service is disabled and send attempts fail with a clear error).
        self.client_id = settings.AZURE_CLIENT_ID
        self.client_secret = settings.AZURE_CLIENT_SECRET
        self.tenant_id = settings.AZURE_TENANT_ID
        
        # Sender mailbox for Graph sendMail (same as OTP_FROM_* env vars).
        self.from_email = get_otp_from_email()

        # Microsoft Graph API endpoints
        self.graph_base_url = "https://graph.microsoft.com/v1.0"
        self.auth_url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
        
        logger.info("EmailOTPService initialized")
    
    def is_configured(self) -> bool:
        """True when all Azure Graph credentials are present."""
        return bool(self.client_id and self.client_secret and self.tenant_id)

    async def get_access_token(self) -> str:
        """Get access token for Microsoft Graph API."""
        if not self.is_configured():
            raise Exception(
                "Azure Graph is not configured (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET)"
            )
        try:
            token_data = {
                'client_id': self.client_id,
                'client_secret': self.client_secret,
                'scope': 'https://graph.microsoft.com/.default',
                'grant_type': 'client_credentials'
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(self.auth_url, data=token_data) as response:
                    if response.status == 200:
                        token_response = await response.json()
                        access_token = token_response.get('access_token')
                        if access_token:
                            logger.info("Successfully obtained Azure access token for email sending")
                            return access_token
                        else:
                            raise Exception("No access token in response")
                    else:
                        error_text = await response.text()
                        raise Exception(f"Token request failed: {response.status} - {error_text}")
        
        except Exception as e:
            logger.error(f"Failed to get Azure access token for email: {e}")
            raise
    
    async def send_otp_email(self, to_email: str, otp: str, username: Optional[str] = None) -> bool:
        """
        Send OTP email via Microsoft Graph API.
        
        Args:
            to_email: Recipient email address
            otp: OTP code to send
            username: Optional username for personalization
            
        Returns:
            True if email sent successfully
        """
        try:
            # Get access token
            access_token = await self.get_access_token()
            
            # Prepare email message
            subject = f"Your {BRAND} sign-in code"
            # the lifetime shown is the real one (OTP_TTL_SECONDS), not a number written into the text
            body_html = otp_email_html(otp, username, minutes=max(1, round(settings.OTP_TTL_SECONDS / 60)))

            # Microsoft Graph API: do NOT set "from" when using application permission
            # (sender is the user in the URL). Some tenants drop delivery if "from" is set.
            message = {
                "message": {
                    "subject": subject,
                    "body": {
                        "contentType": "HTML",
                        "content": body_html
                    },
                    "toRecipients": [
                        {
                            "emailAddress": {
                                "address": to_email
                            }
                        }
                    ]
                },
                "saveToSentItems": True
            }
            
            # Send email via Microsoft Graph API
            send_mail_url = f"{self.graph_base_url}/users/{self.from_email}/sendMail"
            headers = {
                'Authorization': f'Bearer {access_token}',
                'Content-Type': 'application/json'
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(send_mail_url, json=message, headers=headers) as response:
                    if response.status == 202:
                        logger.info(f"OTP email sent successfully to {to_email}")
                        return True
                    elif response.status == 403:
                        # Parse error response
                        try:
                            error_text = await response.text()
                            error_json = await response.json() if 'application/json' in response.headers.get('content-type', '') else {}
                            error_code = error_json.get('error', {}).get('code', 'Unknown')
                            error_message = error_json.get('error', {}).get('message', error_text)
                        except Exception as parse_error:
                            error_text = await response.text()
                            error_code = 'Unknown'
                            error_message = error_text
                            logger.warning(f"Could not parse error response: {parse_error}")
                        
                        logger.error(f"Azure permission denied (403): {error_code} - {error_message}")
                        logger.error(f"Azure Configuration Required:")
                        logger.error(f"   1. Go to Azure Portal: https://portal.azure.com")
                        logger.error(f"   2. Navigate to: Azure Active Directory -> App registrations -> Your App")
                        logger.error(f"   3. Go to 'API permissions' tab")
                        logger.error(f"   4. Click 'Add a permission' -> Microsoft Graph -> Application permissions")
                        logger.error(f"   5. Search for and select 'Mail.Send' permission")
                        logger.error(f"   6. Click 'Add permissions'")
                        logger.error(f"   7. Click 'Grant admin consent for [Your Organization]' (requires admin privileges)")
                        logger.error(f"   8. Ensure mailbox '{self.from_email}' exists and is accessible")
                        logger.error(f"   9. Wait a few minutes for permissions to propagate, then restart the backend service")
                        return False
                    else:
                        error_text = await response.text()
                        logger.error(f"Failed to send OTP email: {response.status} - {error_text}")
                        return False
        
        except Exception as e:
            logger.error(f"Error sending OTP email to {to_email}: {e}")
            return False

# Singleton instance
_email_otp_service: Optional[EmailOTPService] = None

def get_email_otp_service() -> EmailOTPService:
    """Get singleton instance of email OTP service."""
    global _email_otp_service
    if _email_otp_service is None:
        _email_otp_service = EmailOTPService()
    return _email_otp_service
