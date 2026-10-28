"""Application core configuration.

Single source of truth for ALL runtime configuration. Every configurable
value is read from the environment (or `.env`) through the `Settings`
object below — no other module should call `os.getenv` directly.
"""

import os
import sys
from functools import lru_cache
from typing import List

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from `.env` and environment variables."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ---- Environment ----
    ENVIRONMENT: str = Field(
        default="development",
        validation_alias=AliasChoices("ENVIRONMENT", "NODE_ENV"),
    )
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # ---- Compute ----
    # CPU-only deployment. Bound the math libraries so N containers that each load
    # the embedding model don't oversubscribe the host's vCPUs.
    TORCH_NUM_THREADS: int = 1

    # ---- URLs / CORS ----
    FRONTEND_URL: str = "http://localhost:3000"
    FRONTEND_ORIGIN: str = ""  # comma-separated allowed CORS origins (prod)

    # ---- Security / Auth ----
    ENABLE_AUTH: bool = True
    SECRET_KEY: str = Field(
        default="change-me",
        validation_alias=AliasChoices("SECRET_KEY", "JWT_SECRET_KEY"),
    )
    ACCESS_TOKEN_EXPIRES_MIN: int = Field(
        default=720,
        validation_alias=AliasChoices(
            "ACCESS_TOKEN_EXPIRES_MIN",
            "JWT_ACCESS_TOKEN_EXPIRE_MINUTES",
        ),
    )
    ADMIN_USERNAME: str = Field(
        default="admin",
        validation_alias=AliasChoices("ADMIN_USERNAME", "DEFAULT_ADMIN_USERNAME"),
    )
    ADMIN_PASSWORD: str = Field(
        default="admin",
        validation_alias=AliasChoices("ADMIN_PASSWORD", "DEFAULT_ADMIN_PASSWORD"),
    )
    LOCAL_AUTH: bool = False  # dev-only login bypass
    LOCAL_AUTH_USERNAME: str = ""
    LOCAL_AUTH_PASSWORD: str = ""
    LOGIN_MAX_FAILED_ATTEMPTS: int = 5
    LOGIN_LOCKOUT_SECONDS: int = 900
    # A user shows as "online" on the admin page if they made an authenticated
    # request within this many seconds (logout clears it immediately).
    PRESENCE_TTL_SECONDS: int = 120

    # ---- Relational databases ----
    # POSTGRES_* feed the email-processing tables and compose; AUTH_DB_URL /
    # TRACKER_DB_URL are full SQLAlchemy URLs. Point all of these at an AWS
    # RDS endpoint to move auth + tracker + email data off-box (no code change).
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "cv_user"
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = "cv_database"
    # "prefer" matches the local docker Postgres (which has no TLS cert configured);
    # set to "require" in production against RDS. AUTH_DB_URL/TRACKER_DB_URL are full
    # URLs so they take sslmode as a query param instead (?sslmode=require).
    POSTGRES_SSLMODE: str = "prefer"
    AUTH_DB_URL: str = "sqlite:///./auth.db"
    ENABLE_CANDIDATE_TRACKER: bool = False
    TRACKER_DB_URL: str = ""
    ALLOW_PROD_DATA_ACCESS: bool = False
    TRACKER_PROD_URL_HINTS: str = ""  # comma-separated substrings treated as prod

    # ---- Qdrant (vector store) ----
    QDRANT_HOST: str = "qdrant"
    QDRANT_PORT: int = 6333
    QDRANT_MAX_CONNECTIONS: int = 50
    QDRANT_TIMEOUT_SECONDS: int = 30
    QDRANT_API_KEY: str = ""  # optional; when set the client authenticates to Qdrant

    # ---- Redis ----
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_USERNAME: str = ""
    REDIS_PASSWORD: str = ""
    REDIS_MAX_CONNECTIONS: int = 50
    REDIS_SOCKET_TIMEOUT: int = 5
    REDIS_RECONNECT_INTERVAL: int = 30

    # ---- Microsoft Graph (OTP email + mailbox CV intake) ----
    AZURE_TENANT_ID: str = ""
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: str = ""
    AZURE_MAILBOX_EMAIL: str = ""
    OTP_FROM_EMAIL: str = ""
    OTP_FROM_NAME: str = "ATS System"
    OTP_TTL_SECONDS: int = 300
    OTP_MAX_ATTEMPTS: int = 5
    # Dev only: when true, login OTP is not emailed and the generated code is returned
    # in the API response so local dev / automated tests can complete login. MUST be
    # false in production (enforced by validate_production_safety).
    OTP_DISABLE_EMAIL: bool = False
    OTP_RESEND_COOLDOWN_SECONDS: int = 60
    OTP_MAX_SENDS_PER_WINDOW: int = 5
    OTP_SEND_WINDOW_SECONDS: int = 900

    # ---- Image CAPTCHA (alternative second factor to email OTP) ----
    CAPTCHA_LENGTH: int = 6
    CAPTCHA_TTL_SECONDS: int = 300
    CAPTCHA_MAX_ATTEMPTS: int = 5
    CAPTCHA_MAX_SENDS_PER_WINDOW: int = 8
    CAPTCHA_SEND_WINDOW_SECONDS: int = 600
    CAPTCHA_RESEND_COOLDOWN_SECONDS: int = 2

    GRAPH_SEND_RETRIES: int = 2
    GRAPH_SEND_RETRY_DELAY: float = 1.5
    # Shared secret for the public email webhook (/api/email/webhook/email-received).
    # When empty the webhook is DISABLED (returns 404) so it can't be abused
    # anonymously; set it and have Microsoft Graph send it as ?token= or the
    # X-Webhook-Secret header.
    EMAIL_WEBHOOK_SECRET: str = ""

    # ---- OpenAI / LLM ----
    OPENAI_API_KEY: str = ""
    OPENAI_API_BASE: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4.1-mini-2025-04-14"
    OPENAI_MAX_RETRIES: int = 2
    OPENAI_RETRY_BASE_DELAY: float = 0.5
    OPENAI_SEED: int = 1337
    LLM_CACHE_DIR: str = ".llm_cache"
    LLM_TIMEOUT_SECONDS: int = 60
    LLM_BULK_TIMEOUT_SECONDS: int = 300

    # ---- Storage ----
    STORAGE_BACKEND: str = "local"  # local | s3
    LOCAL_STORAGE_DIR: str = "/data/uploads"
    CV_UPLOAD_DIR: str = "/data/uploads/cv"
    S3_BUCKET: str = ""             # required when STORAGE_BACKEND=s3
    S3_REGION: str = ""
    S3_PREFIX: str = ""             # optional key prefix inside the bucket
    MAX_FILE_SIZE_MB: int = 10
    MAX_TEXT_INPUT_CHARS: int = 50000
    # Data retention: raw CV files/text + embeddings older than this can be
    # purged by db/cleanup_old_cvs.py (0 = keep forever). Structured data,
    # notes, tracker, auth and email-dedup records are always kept.
    CV_RETENTION_DAYS: int = 0

    # ---- Embeddings / matching ----
    EMBEDDING_MODEL_NAME: str = "all-mpnet-base-v2"
    EMBEDDING_DIM: int = 768
    EMBEDDING_BATCH_SIZE: int = 64
    EMBEDDING_CACHE_TTL_SECONDS: int = 3600
    # Upper safety ceiling for a single matching job. There is no longer a small
    # hard cap: the match worker streams candidates in bounded chunks, so any
    # realistic number of CVs is fine. This only rejects absurd requests so one
    # job can't monopolise a worker forever. 0 disables the ceiling entirely.
    MATCH_MAX_CVS: int = 5000
    MATCHING_TIMEOUT_SECONDS: int = 3600
    MAX_CONCURRENT_MATCHES: int = 2
    # Threads used for per-candidate scoring inside a single match job. Keep this
    # small on a 4 vCPU host so matching never starves the API.
    MATCH_THREAD_POOL_WORKERS: int = 4
    MATCH_CHUNK_SIZE: int = 50
    # Batch size for retrieving CV embeddings/structured payloads from Qdrant in
    # one round-trip (replaces the old per-CV retrieve loop).
    MATCH_QDRANT_BATCH_SIZE: int = 256
    MATCH_DOC_CACHE_TTL_SECONDS: int = 300
    # In-process cache of Qdrant embedding/structured payloads during a job.
    # ~2 entries per CV + 2 for the JD, so 8000 covers a ~4000-CV job without
    # eviction thrash.
    MATCH_DOC_CACHE_MAX_ITEMS: int = 8000
    MATCH_RESULT_CACHE_ENABLED: bool = True
    MATCH_RESULT_CACHE_TTL_SECONDS: int = 1800
    LIST_CACHE_TTL_SECONDS: int = 60

    # ---- Match job queue (Redis-backed, consumed by the match-worker container) ----
    # When enabled, POST /api/match enqueues a job and returns immediately instead
    # of running the CPU-bound match inside the API process. Falls back to inline
    # execution when disabled or Redis is unreachable.
    ENABLE_MATCH_QUEUE: bool = True
    # How many match jobs may run at once across ALL match-worker replicas.
    MATCH_QUEUE_MAX_CONCURRENT_JOBS: int = 1
    # Poll timeout for the worker's blocking pop (seconds).
    MATCH_QUEUE_POLL_TIMEOUT: int = 5
    # A job whose status record is older than this with no completion is treated
    # as crashed and re-queued on worker startup.
    MATCH_JOB_STALE_SECONDS: int = 5400
    # TTL for the job status + result records in Redis.
    MATCH_JOB_TTL_SECONDS: int = 86400

    # ---- Rate limiting ----
    RATE_LIMIT_DEBUG: bool = False
    ENABLE_RATE_LIMIT_METRICS: bool = True
    MAX_GLOBAL_CONCURRENT: int = 100
    CIRCUIT_BREAKER_THRESHOLD: int = 10
    CIRCUIT_BREAKER_RECOVERY_TIME: int = 120
    CLEANUP_INTERVAL: int = 300
    MEMORY_CLEANUP_THRESHOLD: int = 10000
    REPUTATION_DECAY_RATE: float = 0.05
    REPUTATION_PENALTY_RATE: float = 0.02
    MIN_REPUTATION: float = 0.5
    TRUST_PROXY_HEADERS: bool = True
    ALLOWED_PROXY_IPS: str = "172.16.0.0/12,10.0.0.0/8"

    # ---- Queues / workers ----
    ENABLE_APPLICATION_QUEUE: bool = True
    # Route public careers applications through the Redis queue consumed by the
    # dedicated background-worker container (recommended in production). Falls
    # back to in-process background processing when disabled or Redis is down.
    ENABLE_PUBLIC_CV_QUEUE: bool = False
    MAX_CONCURRENT_APPLICATIONS: int = 5
    APPLICATION_TIMEOUT_SECONDS: int = 300
    MIN_QUEUE_WORKERS: int = 8
    MAX_QUEUE_WORKERS: int = 16
    QUEUE_SIZE_THRESHOLD: int = 10000

    # ---- System thresholds ----
    MEMORY_THRESHOLD_MB: int = 12288
    CPU_THRESHOLD_PERCENT: int = 85

    # ---- Feature flags ----
    ENABLE_EMAIL_SCHEDULER: bool = False
    SEND_EMAIL_REMINDER_FOLLOWUP: bool = False
    EMAIL_CHECK_INTERVAL_MINUTES: int = 5
    EMAIL_MAX_BATCH_SIZE: int = 10
    EMAIL_SCHEDULE_UTC: str = ""
    FOLLOWUP_REMINDER_TZ: str = "Asia/Dubai"

    # ---------------- Derived helpers ----------------

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.strip().lower() == "production"

    @property
    def is_development(self) -> bool:
        return not self.is_production

    @property
    def max_file_size_bytes(self) -> int:
        return self.MAX_FILE_SIZE_MB * 1024 * 1024

    @property
    def cors_origins(self) -> List[str]:
        """Allowed CORS origins, derived from FRONTEND_ORIGIN / FRONTEND_URL."""
        origins: List[str] = []
        for raw in (self.FRONTEND_ORIGIN, self.FRONTEND_URL):
            for item in raw.split(","):
                item = item.strip().rstrip("/")
                if item and item not in origins:
                    origins.append(item)
        if self.is_development:
            for dev_origin in (
                "http://localhost:3000",
                "http://localhost:8000",
                "http://localhost",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:8000",
                "http://127.0.0.1",
            ):
                if dev_origin not in origins:
                    origins.append(dev_origin)
        return origins

    def validate_production_safety(self) -> None:
        """Fail fast when insecure defaults reach a production environment."""
        if not self.is_production:
            if self.SECRET_KEY == "change-me":
                print(f"WARNING: Using default SECRET_KEY in {self.ENVIRONMENT} environment")
                print("Generate one: python -c 'import secrets; print(secrets.token_urlsafe(48))'")
            return

        problems = []
        if self.SECRET_KEY == "change-me" or len(self.SECRET_KEY) < 32:
            problems.append("SECRET_KEY (or JWT_SECRET_KEY) must be set to a strong value")
        if self.ADMIN_USERNAME == "admin" and self.ADMIN_PASSWORD == "admin":
            problems.append("ADMIN_USERNAME/ADMIN_PASSWORD are still defaults")
        if self.LOCAL_AUTH:
            problems.append("LOCAL_AUTH (dev login bypass) must be disabled in production")
        if self.OTP_DISABLE_EMAIL:
            problems.append("OTP_DISABLE_EMAIL must be false in production")
        if problems:
            for p in problems:
                print(f"CRITICAL: {p}")
            sys.exit(1)


settings = Settings()
settings.validate_production_safety()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return settings


# ---------------------------------------------------------------------------
# Backwards-compatible helpers (legacy call sites / tests read env per call so
# runtime overrides keep working).
# ---------------------------------------------------------------------------

def _env_truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def is_otp_email_sending_disabled() -> bool:
    """When True (dev only), login OTP is not emailed; the generated code is returned
    in the API response so local dev / tests can complete the login flow."""
    return _env_truthy("OTP_DISABLE_EMAIL")


def get_otp_from_email() -> str:
    """Mailbox used as Graph ``/users/{id}/sendMail`` sender."""
    return (os.getenv("OTP_FROM_EMAIL") or settings.OTP_FROM_EMAIL or settings.AZURE_MAILBOX_EMAIL).strip()


def get_otp_from_name() -> str:
    return os.getenv("OTP_FROM_NAME", settings.OTP_FROM_NAME).strip() or "ATS System"


def is_followup_email_reminder_enabled() -> bool:
    """Master flag for follow-up reminder emails."""
    return _env_truthy("SEND_EMAIL_REMINDER_FOLLOWUP")
