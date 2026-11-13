# app/main.py
"""
Main Application - FastAPI Entry Point
Clean startup + routing wired to new Qdrant collections:
  - *_documents, *_structured, *_embeddings
"""

import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Routers
from app.api.routers import careers, cvs, job_descriptions, matching, monitor, notices, storage, system
from app.api.routers.auth import router as auth_router
from app.api.routers.agents import router as agents_router
from app.api.routers.agentic import router as agentic_router
from app.api.routers.interview_agent import router as interview_agent_router
from app.api.routers.linkedin_agent import router as linkedin_agent_router
from app.api.routers.admin import router as admin_router
from app.api.routers.bug_reports import router as bug_reports_router
from app.api.routers.hiring_image import router as hiring_image_router
from app.api.routers.tracker import router as tracker_router
from app.api.routers.tracker_closures import router as tracker_closures_router
from app.api.routers.tracker_selections import router as tracker_selections_router

# Services init
from app.config.settings import settings
from app.db.startup_lock import schema_init_lock
from app.monitoring.recorder import get_recorder
from app.store import get_store
from app.providers.embeddings.service import get_embedding_service
from app.providers.cache.memory import get_cache_service
from app.db.database import init_database

# --------------------
# Logging
# --------------------
from app.config.logging import configure_logging
configure_logging()
logger = logging.getLogger("cv-analyzer")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    get_recorder().set_kind("api")
    try:
        logger.info("Starting CV Analyzer API...")

        # The OpenRouter key is optional at start (warn if missing, but don't fail)
        if not (settings.OPENROUTER_API_KEY or os.getenv("OPENROUTER_API_KEY")):
            logger.warning("OPENROUTER_API_KEY is not set - CV extraction, matching analysis and the AI agents are disabled")
        else:
            logger.info(f"OpenRouter configured (model {settings.LLM_MODEL})")

        logger.info(f"Qdrant: {settings.QDRANT_HOST}:{settings.QDRANT_PORT}")

        # Initialize core dependencies
        logger.info("Initializing the vector store (Qdrant collections)...")
        get_store().vectors.client   # connects and creates the two vector collections if they are missing
        logger.info("Qdrant ready")
        
        logger.info("Warming embedding service...")
        get_embedding_service()
        logger.info("Embedding service ready")

        logger.info("Initializing cache service...")
        get_cache_service()
        logger.info("Cache ready")

        logger.info("Initializing Redis cache...")
        from app.providers.cache.redis import get_redis_cache
        get_redis_cache()
        logger.info("Redis cache ready")

        # One process at a time applies the migrations (see app/db/startup_lock.py)
        with schema_init_lock():
            logger.info("Initializing database...")
            init_database()
            logger.info("Database ready")

        logger.info("Startup complete")
        yield
        # Graceful shutdown
        logger.info("Shutting down CV Analyzer API...")
        logger.info("Shutdown complete")
    except Exception as e:
        logger.error(f"Startup failed: {e}")
        raise


app = FastAPI(
    title="CV Analyzer API",
    description="AI-powered CV analysis and job matching with explainable, deterministic scoring.",
    version="2.0.0",
    lifespan=lifespan,
    # Hide the interactive API schema/docs in production (info disclosure).
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# --------------------
# CORS
# --------------------
# Origins are derived from FRONTEND_ORIGIN / FRONTEND_URL (plus localhost in dev).
is_development = settings.is_development
allow_origins = settings.cors_origins
logger.info(f"CORS origins configured: {allow_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Rate limiting middleware (MUST be first)
from app.api.middleware.rate_limiter import rate_limit_middleware
app.middleware("http")(rate_limit_middleware)

# Request metrics for the Monitor page: latency / errors per route template (never raises, never blocks)
_UNMETERED = ("/api/health", "/api/monitor", "/metrics")


@app.middleware("http")
async def record_request_metrics(request, call_next):
    started = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    finally:
        path = request.url.path
        if not path.startswith(_UNMETERED):
            route = request.scope.get("route")
            get_recorder().record(
                "api", f"{request.method} {getattr(route, 'path', 'unmatched')}", "http",
                (time.perf_counter() - started) * 1000, status="ok" if status < 500 else "error",
                detail={"status": status, "path": path} if status >= 500 else None)


# Trust proxy headers middleware (for ALB)
@app.middleware("http")
async def trust_proxy_headers(request, call_next):
    """Normalize request scheme when behind a proxy/ALB using X-Forwarded-Proto."""
    # Handle X-Forwarded-Proto for HTTPS detection behind ALB
    forwarded_proto = request.headers.get("X-Forwarded-Proto") if settings.TRUST_PROXY_HEADERS else None
    if forwarded_proto == "https":
        # Update the request URL scheme for proper HTTPS detection
        request.scope["scheme"] = "https"
    
    response = await call_next(request)
    return response

# Security headers middleware
@app.middleware("http")
async def add_security_headers(request, call_next):
    """Add common security headers for HTTPS requests in non-development environments."""
    response = await call_next(request)
    
    # Check if request is HTTPS (including via ALB forwarding)
    is_https = (request.scope.get("scheme", request.url.scheme) == "https" or 
                request.headers.get("X-Forwarded-Proto") == "https")
    
    # These cost nothing and are right on every response, over HTTP or HTTPS, in every environment.
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    # Sign-in answers (tokens, CAPTCHA images) must never be stored by a browser or a proxy.
    if request.url.path.startswith("/api/auth/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    # HSTS only makes sense over HTTPS, and not for local development.
    if not is_development and is_https:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    
    return response

# --------------------
# Routes
# --------------------
# Auth routes
app.include_router(auth_router)
app.include_router(agents_router)
app.include_router(agentic_router)
app.include_router(interview_agent_router)
app.include_router(linkedin_agent_router)
app.include_router(admin_router)
app.include_router(bug_reports_router)
app.include_router(hiring_image_router)
app.include_router(tracker_router)
app.include_router(tracker_closures_router)
app.include_router(tracker_selections_router)
app.include_router(notices.router)

# Core routes
app.include_router(cvs.router, prefix="/api/cv", tags=["CV Management"])
app.include_router(job_descriptions.router, prefix="/api/jd", tags=["Job Description Management"])
app.include_router(matching.router, prefix="/api", tags=["Matching & System"])
app.include_router(system.router, prefix="/api", tags=["Matching & System"])

# Monitor page (admin): model calls, queue, workers, system health
app.include_router(monitor.router)

# Careers routes (public job postings & applications)
app.include_router(careers.router, prefix="/api/careers", tags=["Careers & Public Applications"])

app.include_router(storage.router, prefix="/api/storage", tags=["Local Storage"])



# --------------------
# Root + Error handlers
# --------------------
@app.get("/")
async def root():
    return {
        "message": "CV Analyzer API",
        "version": "2.0.0",
        "status": "running",
        "description": "AI-powered CV analysis and job matching system",
        "endpoints": {
            "cv_management": "/api/cv",
            "jd_management": "/api/jd",
            "matching_deterministic": "/api/match",
            "text_match": "/api/match-text",
            "health": "/api/health",
            "auth_login": "/api/auth/login",
            "auth_me": "/api/auth/me",
            "admin_users": "/api/admin/users",
            "careers_admin": "/api/careers/admin",
            "careers_public": "/api/careers/jobs/{public_token}",
            "careers_apply": "/api/careers/jobs/{public_token}/apply",
            "docs": "/docs",
            "redoc": "/redoc",
        },
        "features": [
            "Document processing (PDF, DOCX, OCR)",
            "LLM standardization for CV/JD",
            f"Vector embeddings ({settings.EMBEDDING_MODEL_NAME}, {settings.EMBEDDING_DIM}d)",
            "EXACT 32-vector storage for embeddings (Qdrant: vectors only; PostgreSQL: every fact)",
            "Explainable + Hungarian deterministic matching",
            "Bulk processing & top candidate search",
            "JWT Authentication & User Management",
            "Public job postings with secure tokens",
            "Anonymous job applications",
            "Careers page functionality",
        ],
        "qdrant_collections": ["candidate_vectors", "job_description_vectors"],   # vectors only; every fact is in PostgreSQL
    }


from fastapi import HTTPException as _HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import TimeoutError as _SATimeout


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request, exc):
    """422 with where and why, but WITHOUT echoing what the caller sent (FastAPI's default repeats the input: passwords in a
    malformed login body, megabytes of junk, and a deeply nested body crashed the encoder with a 500)."""
    try:
        errors = [{"loc": [str(x) if not isinstance(x, int) else x for x in e.get("loc", ())], "msg": str(e.get("msg", ""))[:200],
                   "type": str(e.get("type", ""))} for e in exc.errors()[:50]]
    except RecursionError:
        errors = [{"loc": ["body"], "msg": "Request body is nested too deeply", "type": "too_deep"}]
    return JSONResponse(status_code=422, content={"detail": errors})


@app.exception_handler(_SATimeout)
async def pool_busy_handler(request, exc):
    logger.error("Database connection pool exhausted")
    return JSONResponse(status_code=503, headers={"Retry-After": "5"},
                        content={"error": "The server is busy. Please try again in a moment.", "detail": "The server is busy. Please try again in a moment.", "type": "busy"})


@app.exception_handler(RecursionError)
async def too_deep_handler(request, exc):
    return JSONResponse(status_code=400, content={"error": "Request body is nested too deeply", "detail": "Request body is nested too deeply", "type": "http_error"})


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled exception: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "message": "An unexpected error occurred. Please try again later.",
            "type": "internal_error",
        },
    )


@app.exception_handler(_HTTPException)
async def http_exception_handler(request, exc):
    logger.warning(f"HTTP exception: {exc.status_code} - {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail,
            "detail": exc.detail,  # standard FastAPI key, kept for client compatibility
            "status_code": exc.status_code,
            "type": "http_error",
        },
        headers=getattr(exc, "headers", None),  # keep Retry-After / WWW-Authenticate set by the route
    )


if __name__ == "__main__":
    import uvicorn

    host = settings.HOST
    port = settings.PORT
    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run("app.main:app", host=host, port=port, reload=False, log_level="info")