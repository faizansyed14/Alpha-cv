"""Logging in for the offline harness scripts (e2e_smoke*.py, run_demo_server.py, dynamic_security_test.py, test_rbac.py).

Every account needs a second factor, so there is no password-only login. This does the real two-step flow: the password
(/verify-password), then the CAPTCHA (/captcha, /captcha/verify). A development server also returns the answer as ``dev_code``,
which is what the script reads, so the whole flow runs without a person.
"""


ADMIN_EMAIL = "admin@harness.test"        # what the scripts set as ADMIN_EMAIL before the app starts


def login_with_captcha(client, email: str, password: str, fingerprint: str = "harness"):
    """The response of /captcha/verify: status 200 and an ``access_token`` when the login worked. Everyone signs in with their email."""
    client.post("/api/auth/verify-password", json={"email": email, "password": password})
    challenge = client.post("/api/auth/captcha", json={"email": email, "password": password, "fingerprint": fingerprint})
    body = challenge.json() or {}
    if challenge.status_code != 200:                      # e.g. 429: the CAPTCHA was asked for too often; say so instead of failing on a missing id
        print(f"[harness login] the CAPTCHA was refused: {challenge.status_code} {str(body)[:200]}")
    return client.post("/api/auth/captcha/verify", json={
        "email": email, "captcha_id": body.get("captcha_id"), "answer": body.get("dev_code", ""), "fingerprint": fingerprint})
