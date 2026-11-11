# Security notes (OWASP Top 10 review, November 2026)

What the code enforces, where, and what is a deliberate decision. Run `backend/tests/test_owasp_hardening.py` and the CI workflow `.github/workflows/security.yml` to keep it true.

| | Control | Where |
|---|---|---|
| A01 Access control | Every route has a guard (`require_core_app` for every signed-in role, `require_admin` for users, agent usage, monitoring and bug reports; 15 public routes, all intended). Job postings: owner or admin (`_own_job_or_403`). Agent conversations, saved CVs, bug reports: scoped to the caller. Files are found by exact id. Tokens are dropped when a password or email changes or an account is removed. | `api/deps.py`, `routers/*`, `security/auth.py` |
| A02 Configuration | Production refuses to start with a weak `SECRET_KEY`, default or weak admin password, `LOCAL_AUTH` or `OTP_DISABLE_EMAIL`. `/docs` is off in production. Database, Redis and Qdrant ports are published on 127.0.0.1 only (local, dev); prod publishes nginx only. All containers run as non-root. Security headers on every response; HSTS, CSP, TLS 1.2/1.3 at the prod nginx; sign-in has its own stricter rate zone. | `settings.py`, `main.py`, `nginx/*`, compose files |
| A03 Supply chain | Every Python dependency is pinned to an exact version; `pip-audit` and `npm audit` run weekly and on each PR; Dependabot raises update PRs. The embedding model is pinned to a revision and verified by SHA-256 at build. | `requirements.txt`, `.github/*`, `model_server/Dockerfile` |
| A04 Cryptography | Passwords: Argon2id (bcrypt hashes still verify and are upgraded). OTP and CAPTCHA codes come from `secrets`. JWT HS256 with a 32+ character key, `exp`, `jti`, algorithm pinned on decode. TLS terminates at nginx / the load balancer. | `security/auth.py` |
| A05 Injection | SQL is built with bound parameters (the one dynamic table name comes from a fixed list). No `eval`, `pickle`, `yaml.load` or shell calls with user input. Uploaded DOCX HTML is sanitized, ODT entities are refused, e-mail HTML escapes names. | `ingestion/cv_parser.py`, `sanitizeDom.ts` |
| A06 Design | Sign-in needs a password plus a second factor; lockout per account and per account+IP; CAPTCHA and OTP are rate limited; unknown and wrong-password answers are identical (a dummy hash keeps the timing equal). | `routers/auth.py`, `login_guard.py` |
| A07 Authentication | Passwords: at least 10 characters, not common, not containing the username or e-mail (API and admin password in production). Logout revokes the token. | `security/password_policy.py` |
| A08 Integrity | JSON-only cache serialization; pinned model with checksum; migrations are the only schema path. | |
| A09 Logging | Security events (`alphacv.security` logger): login failed / ok, lockout, access denied, rejected token, user created / changed / deleted, logout. Emails are masked, secrets never logged, values are single-line. Alert on `login_locked` and bursts of `login_failed` / `access_denied`. | `security/logsafe.py` |
| A10 Exceptions | Clients get a generic message on any 500; the cause goes to the server log. | `routers/*`, test `test_no_route_returns_exception_text_in_a_500` |

## Banning abusive addresses (fail2ban, on the EC2 host)

`sudo ./scripts/system/setup-fail2ban.sh install` (after `./scripts/start.sh prod`). nginx writes its access log to `/var/log/alphacv-nginx/access.log`; fail2ban bans at the firewall (the `DOCKER-USER` chain, through an ipset) any address that: gets 15 refused sign-in answers in a minute, 40 scanner-style misses in a minute, or 300 throttled (429) answers in a minute, for one hour (only error answers count, never successful ones, so normal use and matching are not affected); a third ban within a day lasts a week. `setup-fail2ban.sh status` lists the bans, `unban IP` lifts one. Expect about 30-50 MB of RAM and almost no CPU when idle. It helps against a few misbehaving addresses; it does not stop a flood from thousands of addresses (use a CDN/WAF in front for that).

## Decisions left open

- **Token storage.** The JWT is in `localStorage` (12 h). An HttpOnly cookie would remove theft by XSS but needs CSRF protection and a frontend change.
- **Revocation when Redis is down** fails open (a logged-out token works until it expires). Failing closed would lock everyone out during a Redis outage.
- **CSP** still allows `unsafe-inline` / `unsafe-eval` because Next.js needs them without nonces.
- **Redis password** (`REDIS_PASSWORD`) is optional; it is on a private network and never published in prod.
- **Base images** use floating tags (Dependabot updates them); pin digests if you need reproducible builds.
- **pytest** (a test-only package in the shared requirements) has an advisory fixed in 9.0.3; moving test packages to a separate file would remove it from the runtime image.
