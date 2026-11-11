"""Application core configuration.

Single source of truth for ALL runtime configuration. Every configurable
value is read from the environment (or `.env`) through the `Settings`
object below, no other module should call `os.getenv` directly.
"""

import os
import sys
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
    # The admin signs in with an email like everyone else. It is read from the environment only (.env: ADMIN_EMAIL=...), never written in
    # the code. It is set on the admin account when that is created, and on an existing admin that has no email yet; change it afterwards
    # on the Users page (the admin edits their own account there).
    ADMIN_EMAIL: str = Field(
        default="",
        validation_alias=AliasChoices("ADMIN_EMAIL", "DEFAULT_ADMIN_EMAIL"),
    )
    LOCAL_AUTH: bool = False  # dev-only login bypass
    LOCAL_AUTH_USERNAME: str = ""
    LOCAL_AUTH_PASSWORD: str = ""
    LOGIN_MAX_FAILED_ATTEMPTS: int = 5
    # Failures from ALL addresses together before the account itself is locked (stops distributed guessing).
    LOGIN_MAX_FAILED_ATTEMPTS_PER_ACCOUNT: int = 50
    # Failures from ONE address across ALL accounts before that address is refused (credential stuffing tries one password on
    # thousands of accounts, so no single account ever locks). Also stops one address from making the server hash passwords
    # all day. Sized for an office of recruiters behind one address.
    LOGIN_MAX_FAILED_ATTEMPTS_PER_IP: int = 30
    LOGIN_LOCKOUT_SECONDS: int = 900
    # A user shows as "online" on the admin page if they made an authenticated
    # request within this many seconds (logout clears it immediately).
    PRESENCE_TTL_SECONDS: int = 120

    # ---- Relational database ----
    # ONE PostgreSQL database holds everything relational: users, the AI agents' history and bug reports.
    # A full SQLAlchemy URL; point it at an AWS RDS endpoint to move it off-box (add ?sslmode=require for RDS).
    # The default is a local SQLite file, for tests and quick tries only.
    DATABASE_URL: str = "sqlite:///./app.db"
    # Connections each process may hold open to PostgreSQL: (DB_POOL_SIZE + DB_MAX_OVERFLOW) x the number of processes (backend workers,
    # background worker, match workers) must stay below PostgreSQL's max_connections (100 by default).
    DB_POOL_SIZE: int = 8
    DB_MAX_OVERFLOW: int = 8
    DB_POOL_TIMEOUT_SECONDS: int = 10
    # A search that runs longer than this is cancelled by PostgreSQL, so one expensive query cannot hold the database for everyone.
    SEARCH_STATEMENT_TIMEOUT_SECONDS: int = 30
    ALLOW_PROD_DATA_ACCESS: bool = False
    PROD_DB_URL_HINTS: str = ""  # comma-separated substrings treated as prod

    # ---- Qdrant (vector store) ----
    QDRANT_HOST: str = "qdrant"
    QDRANT_PORT: int = 6333
    QDRANT_GRPC_PORT: int = 6334            # vectors are read over gRPC (binary): about 2.5x faster than JSON over REST
    QDRANT_PREFER_GRPC: bool = True
    QDRANT_TIMEOUT_SECONDS: int = 30
    QDRANT_API_KEY: str = ""  # optional; when set the client authenticates to Qdrant

    # ---- Redis ----
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_USERNAME: str = ""
    REDIS_PASSWORD: str = ""
    REDIS_MAX_CONNECTIONS: int = 50
    REDIS_SOCKET_TIMEOUT: int = 5

    # ---- Microsoft Graph (OTP email + mailbox CV intake) ----
    AZURE_TENANT_ID: str = ""
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: str = ""
    AZURE_MAILBOX_EMAIL: str = ""
    OTP_FROM_EMAIL: str = ""
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


    # ---- LLM: every model call goes through OpenRouter (one key, one OpenAI-style API, many models) ----
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    LLM_MODEL: str = "anthropic/claude-haiku-5.5"      # CV / JD extraction, match analysis and the agents
    # Prompt caching (Anthropic models through OpenRouter): the long instructions every call starts with are billed at about a tenth of
    # the normal input price when the same start was sent in the last few minutes, and the model begins answering sooner. The call that
    # writes an entry pays 25% more on that part (100% more with "1h"), so it pays off when calls come in bursts (bulk uploads, matching, a
    # chat that goes back and forth). "5m" or "1h" is how long an entry lives; false turns the marking off (other models cache a
    # repeated start by themselves, with no marking).
    LLM_PROMPT_CACHE: bool = True
    LLM_PROMPT_CACHE_TTL: str = "5m"
    LLM_MAX_RETRIES: int = 2
    LLM_RETRY_BASE_DELAY: float = 0.5
    # true = only route to providers that keep no prompts or completions (OpenRouter zero-data-retention); CVs are personal data
    OPENROUTER_ZDR: bool = False
    OPENROUTER_SITE_URL: str = ""                        # optional: shown on OpenRouter's dashboard
    OPENROUTER_APP_NAME: str = "Alpha CV"

    # ---- AI agents (interview questions, LinkedIn posts) ----
    # What the agents may spend. Tokens (input + output of every answered call) are the only meter: there are no call counts.
    AGENT_TOKENS_PER_USER_PER_DAY: int = 500_000     # per person, per UTC day; an admin can reset one person's count (or approve their request)
    AGENT_TOKENS_GLOBAL_PER_DAY: int = 5_000_000     # circuit breaker across everyone, so a bug or many accounts cannot run up the bill
    AGENT_OUTPUT_CEILING_TOKENS: int = 32_000        # the model's own output limit, NOT a policy cap: an answer is only ever shortened by it or by the tokens left today
    AGENT_MIN_OUTPUT_TOKENS: int = 600               # a call is not started unless at least this much room is left for the answer
    AGENT_MAX_CV_CHARS: int = 8_000                  # candidate CV text sent with every call of a CV-aware conversation (about 2,000 tokens)
    AGENT_MAX_JD_CHARS: int = 12_000                 # job text sent with every call (about 3,000 tokens)
    AGENT_HISTORY_TURNS: int = 1                     # earlier answered turns sent back to the model (each one costs tokens again)
    AGENT_TIMEOUT_SECONDS: int = 90

    # ---- Agentic mode: one assistant that uses the app's own features through specialists (see app/agentic) ----
    # Models are chosen per ROLE, each one OpenRouter model id; an empty value means "use LLM_MODEL".
    AGENTIC_ENABLED: bool = True
    AGENTIC_MODEL_ROUTER: str = ""        # picks the specialist when the keyword rules are unsure (a few hundred tokens a call)
    AGENTIC_MODEL_ACT: str = ""           # the specialists' tool-using model
    AGENTIC_MODEL_WRITE: str = ""         # long-form writing inside tools (interview questions, LinkedIn posts)
    AGENTIC_MODEL_FALLBACK: str = ""      # tried once when the model above fails with a transport error; empty = none
    AGENTIC_MAX_STEPS: int = 5            # model calls per turn that may ask for tools
    AGENTIC_MAX_TOOLS_PER_STEP: int = 3
    AGENTIC_TOOL_RESULT_CHARS: int = 6000  # a tool's answer is cut to this before the model sees it
    AGENTIC_MATCH_WAIT_SECONDS: int = 40   # how long the matching tool waits for a result before saying "still running"
    AGENTIC_HISTORY_MESSAGES: int = 8      # earlier messages the model sees

    # ---- Storage ----
    STORAGE_BACKEND: str = "local"  # local | s3
    LOCAL_STORAGE_DIR: str = "/data/uploads"
    CV_UPLOAD_DIR: str = "/data/uploads/cv"
    S3_BUCKET: str = ""             # required when STORAGE_BACKEND=s3
    S3_REGION: str = ""
    S3_PREFIX: str = ""             # optional key prefix inside the bucket
    MAX_FILE_SIZE_MB: int = 10
    # Optional antivirus for uploaded files: tcp://host:3310 of a ClamAV daemon. Empty = off. With CLAMAV_REQUIRED an
    # unreachable scanner rejects the upload instead of letting it through unscanned.
    CLAMAV_URL: str = ""
    CLAMAV_REQUIRED: bool = False
    MAX_TEXT_INPUT_CHARS: int = 50000
    # Data retention: raw CV files/text + embeddings older than this can be
    # purged by db/cleanup_old_cvs.py (0 = keep forever). Structured data,
    # notes, auth and email-dedup records are always kept.

    # ---- Embeddings / matching ----
    # multilingual-e5-small: 384-d vectors. Changing the model or EMBEDDING_DIM means recreating the Qdrant collections and
    # re-uploading the CVs / JDs (the stored vectors are not comparable between models).
    EMBEDDING_MODEL_NAME: str = "intfloat/multilingual-e5-small"
    EMBEDDING_DIM: int = 384
    # e5 models expect a task prefix on every text ("query: " for symmetric similarity, which is what CV-vs-JD matching is).
    # Set it to "" when EMBEDDING_MODEL_NAME is not an e5 model.
    EMBEDDING_TEXT_PREFIX: str = "query: "
    EMBEDDING_BATCH_SIZE: int = 64
    # URL of the model-server container (e.g. http://model-server:8080). Required: the backend image carries no ML runtime.
    EMBEDDING_SERVICE_URL: str = ""
    EMBEDDING_SERVICE_TOKEN: str = ""
    EMBEDDING_SERVICE_TIMEOUT_SECONDS: float = 120.0
    # Texts per HTTP request to the model server (its MODEL_MAX_INPUTS must be >= this).
    EMBEDDING_REQUEST_SIZE: int = 128
    EMBEDDING_CACHE_TTL_SECONDS: int = 3600

    # ---- Monitoring (see app/monitoring) ----
    MONITORING_ENABLED: bool = True
    LLM_DAILY_BUDGET_USD: float = 0.0   # 0 = no budget alert on the Monitor page

    # ---- OCR (RapidOCR on ONNX Runtime; see app/ingestion/ocr.py) ----
    OCR_MAX_CONCURRENT: int = 2      # recognitions running at once per process
    OCR_THREADS: int = 2             # ONNX Runtime threads per recognition
    OCR_MAX_PAGES: int = 8           # scanned pages OCR'd per PDF (CVs are short; guards against huge scans)
    OCR_MIN_IMAGE_PX: int = 150      # embedded images smaller than this (logos, icons) are not OCR'd
    # Upper safety ceiling for a single matching job. There is no longer a small
    # Maximum CVs in ONE match (picked by hand or "newest N"). A request above it is refused, and a match that names
    # no CVs scores only the newest MATCH_MAX_CVS. Raise it deliberately if you need more.
    MATCH_MAX_CVS: int = 10_000
    MATCHING_TIMEOUT_SECONDS: int = 3600
    # Threads used for per-candidate scoring inside a single match job. Keep this
    # small on a 4 vCPU host so matching never starves the API.
    MATCH_THREAD_POOL_WORKERS: int = 4
    MATCH_CHUNK_SIZE: int = 50
    # A CV whose scoring fails (usually a Qdrant timeout under heavy load) is retried this many times, with a
    # growing pause, before it is left out of the result (the result then says how many were left out).
    MATCH_CANDIDATE_RETRIES: int = 2
    # CVs per embeddings request (each CV's 32 vectors are ~0.5 MB of JSON; bigger batches = fewer requests, more RAM).
    MATCH_EMBEDDINGS_FETCH_BATCH: int = 10
    MATCH_RETRY_BACKOFF_SECONDS: float = 1.5
    # Candidates keeping full assignment/alternative detail in a result (the rest keep scores only).
    MATCH_DETAIL_TOP_N: int = 1000
    # Finished results live this long in Redis (job status keeps MATCH_JOB_TTL_SECONDS).
    MATCH_RESULT_TTL_SECONDS: int = 3600
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

    # ---- LLM re-scoring of the best semantic matches ----
    LLM_MATCH_TOP_N: int = 30          # top candidates re-scored by the LLM (the semantic stage only filters; the LLM decides)
    LLM_MATCH_BATCH_SIZE: int = 10     # CVs per LLM request (smaller = faster first results, isolated failures)
    LLM_MATCH_CONCURRENCY: int = 3     # parallel LLM requests per process, across all running matches
    # Candidates whose semantic overall score (0-100) is below this are not sent to the LLM; they keep their semantic score.
    # 0 (default) = off: every candidate in the top LLM_MATCH_TOP_N is sent, even when only a few CVs were matched.
    LLM_MATCH_MIN_SCORE: float = 0.0

    # ---- Mandatory languages / certifications (app/matching/requirements.py) ----
    # A small adjustment to the semantic score before the LLM step: + bonus per met mandatory CERTIFICATE (a language match earns
    # nothing), x factor per mandatory requirement the CV is known to lack (it lists other languages / certificates but not this one). A CV that lists nothing of
    # that kind is never penalised. Set REQUIREMENTS_MATCHING_ENABLED=false to switch the whole thing off.
    REQUIREMENTS_MATCHING_ENABLED: bool = True
    REQUIREMENT_MET_BONUS: float = 8.0
    REQUIREMENT_MISSING_FACTOR: float = 0.75
    REQUIREMENT_PREFERRED_BONUS: float = 3.0

    # ---- Match job queue (Redis-backed, consumed by the match-worker container) ----
    # When enabled, POST /api/match enqueues a job and returns immediately instead
    # of running the CPU-bound match inside the API process. Falls back to inline
    # execution when disabled or Redis is unreachable.
    ENABLE_MATCH_QUEUE: bool = True
    # How many match jobs may run at once across ALL match-worker replicas.
    # 0 = unlimited: the runners (MATCH_WORKER_CONCURRENCY per worker x replicas) are the real concurrency bound.
    MATCH_QUEUE_MAX_CONCURRENT_JOBS: int = 0
    # Jobs one match-worker process runs in parallel (asyncio tasks; each also needs a global slot above).
    MATCH_WORKER_CONCURRENCY: int = 4
    # A worker already running a job only takes another one after it has waited this long, so jobs go to idle
    # worker processes first (jobs in one process share its CPU).
    MATCH_EXTRA_RUNNER_CLAIM_DELAY_SECONDS: float = 3.0
    # Slot lease: a running job renews it every ~third of this; a worker silent for this long is presumed dead.
    MATCH_LEASE_SECONDS: int = 90
    # A job interrupted (worker crash / restart) more than this many times is failed instead of retried forever.
    MATCH_JOB_MAX_ATTEMPTS: int = 3
    # On SIGTERM a worker lets running jobs finish this long before handing them back to the queue.
    MATCH_SHUTDOWN_GRACE_SECONDS: int = 100
    # Admission control (0 disables a limit). A person can have this many matches queued or running at once; a normal user runs one
    # or two, so a third is already unusual, and the limit stops a script or a stuck page from filling the queue. When the queue
    # holds this many waiting jobs, new ones are refused with a clear message and Retry-After (the page shows it) instead of
    # waiting hours. Both are answered with 429; a retry of the SAME request returns the existing job and is never counted twice.
    MATCH_QUEUE_MAX_JOBS_PER_USER: int = 3
    MATCH_QUEUE_MAX_DEPTH: int = 100
    # Poll timeout for the worker's blocking pop (seconds).
    MATCH_QUEUE_POLL_TIMEOUT: int = 5
    # A job whose status record is older than this with no completion is treated
    # as crashed and re-queued on worker startup.
    MATCH_JOB_STALE_SECONDS: int = 5400
    # TTL for the job status + result records in Redis.
    MATCH_JOB_TTL_SECONDS: int = 86400

    # ---- Rate limiting ----
    MAX_GLOBAL_CONCURRENT: int = 100
    CIRCUIT_BREAKER_THRESHOLD: int = 10
    CIRCUIT_BREAKER_RECOVERY_TIME: int = 120
    REPUTATION_DECAY_RATE: float = 0.05
    REPUTATION_PENALTY_RATE: float = 0.02
    MIN_REPUTATION: float = 0.5
    TRUST_PROXY_HEADERS: bool = True
    # Peers allowed to set X-Forwarded-For / X-Real-IP (nginx, the Docker network, a cloud load balancer). Forwarding
    # headers from anyone else are ignored, so a client cannot choose its own IP for rate limiting / login throttling.
    ALLOWED_PROXY_IPS: str = "127.0.0.0/8,::1/128,172.16.0.0/12,10.0.0.0/8,192.168.0.0/16"

    # ---- Queues / workers ----
    # Route public careers applications through the Redis queue consumed by the
    # dedicated background-worker container (recommended in production). Falls
    # back to in-process background processing when disabled or Redis is down.
    ENABLE_PUBLIC_CV_QUEUE: bool = False
    # CV ingestion workers (uploads and job-page applications run in the background worker, many files at a time).
    # Uploads are queued only while a worker is online; otherwise the API processes them itself, as before.
    ENABLE_INGEST_QUEUE: bool = True
    INGEST_WORKER_CONCURRENCY: int = 4     # CVs being processed at once per worker
    INGEST_LLM_CONCURRENCY: int = 4        # of those, how many may be waiting on the LLM at once (rate-limit guard)
    INGEST_EMBED_CONCURRENCY: int = 2      # ... and on the embedding model server

    # ---- System thresholds ----
    CPU_THRESHOLD_PERCENT: int = 85

    # ---- Feature flags ----

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
        from app.security.password_policy import password_problem
        weak = password_problem(self.ADMIN_PASSWORD, username=self.ADMIN_USERNAME, email=self.ADMIN_EMAIL)
        if weak:
            problems.append(f"ADMIN_PASSWORD is too weak: {weak.lower()}")
        if not self.ADMIN_EMAIL.strip():
            problems.append("ADMIN_EMAIL must be set (the admin signs in with it)")
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


