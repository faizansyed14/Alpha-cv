"""System endpoints: health check, system stats, and database introspection / maintenance."""
import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.api.deps import require_admin
from app.config.settings import settings
from app.models.user import User
from app.providers.cache.memory import get_cache_service
from app.providers.embeddings.service import get_embedding_service
from app.store import get_store

logger = logging.getLogger(__name__)

router = APIRouter()

# ----------------------------
# Health & system stats
# ----------------------------
def _is_admin_request(request: Request) -> bool:
    """True when the caller sent a valid (unrevoked) admin token. /api/health itself stays public."""
    header = request.headers.get("authorization") or ""
    if not header.lower().startswith("bearer "):
        return False
    try:
        from app.security.auth import decode_token
        return decode_token(header.split(" ", 1)[1].strip()).get("role") == "admin"
    except Exception:
        return False


def _service_status(svc: Any) -> str:
    svc = svc or {}
    if svc.get("status"):
        return svc["status"]
    return "healthy" if svc.get("model_loaded") or svc.get("is_connected") else "unknown"


def _public_health(status: dict) -> dict:
    """What anyone may see: overall and per-service status only. Hosts, ports, model names, error text and whether
    an OpenAI key is set are internal details for admins."""
    return {
        "status": status.get("status"),
        "timestamp": status.get("timestamp"),
        "services": {name: {"status": _service_status(svc)} for name, svc in (status.get("services") or {}).items()},
    }


@router.get("/health")
async def health_check(request: Request) -> JSONResponse:
    """
    Verify services and DB connectivity. Full detail only for an admin token.
    """
    try:
        status = {"status": "healthy", "timestamp": time.time(), "services": {}}
        try:
            status["services"]["qdrant"] = get_store().health_check()
        except Exception as e:
            status["services"]["qdrant"] = {"status": "unhealthy", "error": str(e)}
            status["status"] = "degraded"
        try:
            emb = get_embedding_service()
            status["services"]["embedding"] = emb.health_check()
        except Exception as e:
            status["services"]["embedding"] = {"status": "unhealthy", "error": str(e)}
            status["status"] = "degraded"
        try:
            # Try Redis cache first
            from app.providers.cache.redis import get_redis_cache
            redis_cache = get_redis_cache()
            status["services"]["cache"] = redis_cache.health_check()
        except Exception:
            # Fallback to in-memory cache
            try:
                cache = get_cache_service()
                status["services"]["cache"] = {"status": "healthy", "stats": cache.get_stats(), "type": "in-memory"}
            except Exception as e2:
                status["services"]["cache"] = {"status": "unhealthy", "error": str(e2)}
                status["status"] = "degraded"
        import os
        status["environment"] = {
            "openai_key_configured": bool(settings.OPENROUTER_API_KEY or os.getenv("OPENROUTER_API_KEY")),   # field name kept for the admin page
            "llm_model": settings.LLM_MODEL,
            "qdrant_host": settings.QDRANT_HOST,
            "qdrant_port": str(settings.QDRANT_PORT),
        }
        return JSONResponse(status if _is_admin_request(request) else _public_health(status))
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse({"status": "unhealthy", "timestamp": time.time()}, status_code=500)

@router.get("/system-stats")
async def get_system_stats(_: User = Depends(require_admin)) -> JSONResponse:
    """
    Count items and provide light analytics (the counts and skill averages come straight from the tables).
    """
    try:
        store = get_store()
        cache = get_cache_service()
        counts, skills = cache.get("stats", namespace="system"), None
        if counts is None:               # two full-table aggregates: computed at most once a minute, however often the page is opened
            counts = {"counts": await asyncio.to_thread(store.library_counts), "skills": await asyncio.to_thread(store.skill_stats)}
            cache.set("stats", counts, ttl_seconds=60, namespace="system")
        counts, skills = counts["counts"], counts["skills"]
        total_cvs, total_jds = counts["cvs"], counts["jds"]
        stats = {
            "database_stats": {"total_cvs": total_cvs, "total_jds": total_jds, "total_documents": total_cvs + total_jds},
            "cv_analytics": {"total_cvs": total_cvs, "avg_skills_per_cv": skills["cv"]["avg"], "max_skills_per_cv": skills["cv"]["max"],
                             "min_skills_per_cv": skills["cv"]["min"]},
            "jd_analytics": {"total_jds": total_jds, "avg_skills_per_jd": skills["jd"]["avg"], "max_skills_per_jd": skills["jd"]["max"],
                             "min_skills_per_jd": skills["jd"]["min"]},
            "cache_stats": get_cache_service().get_stats(),
            "system_info": {
                "embedding_model": settings.EMBEDDING_MODEL_NAME,
                "embedding_dimension": settings.EMBEDDING_DIM,
                "llm_model": settings.LLM_MODEL,
                "similarity_metric": "cosine",
            },
        }
        return JSONResponse({"status": "success", "stats": stats, "timestamp": time.time()})
    except Exception as e:
        logger.error(f"Failed to gather system stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to gather system stats. Please try again or contact support.")

# ----------------------------
# DB Introspection
# ----------------------------
@router.get("/database/status")
async def get_database_status(_: User = Depends(require_admin)):
    """The two places data lives: the tables (every fact) and the Qdrant collections (the vectors)."""
    try:
        store = get_store()
        q = store.vectors.client
        collections = []
        for c in q.get_collections().collections:
            info = q.get_collection(c.name)
            vectors = info.config.params.vectors
            if hasattr(vectors, "size"):
                vector_config = {"size": vectors.size, "distance": str(vectors.distance)}
            else:
                vector_config = {n: {"size": v.size, "distance": str(v.distance)} for n, v in vectors.items()}
            collections.append({"name": c.name, "points_count": info.points_count, "vector_config": vector_config,
                                "status": str(info.status), "indexed_vectors_count": info.indexed_vectors_count})
        tables = await asyncio.to_thread(store.table_counts)
        return JSONResponse({"status": "success", "collections": collections, "total_collections": len(collections),
                             "tables": tables, "timestamp": time.time()})
    except Exception as e:
        logger.error(f"Failed to get database status: {e}")
        raise HTTPException(status_code=500, detail="Database status error. Please try again or contact support.")


VIEW_SAMPLE = 50   # records per list in the database view


@router.get("/database/view")
async def view_database(_: User = Depends(require_admin)) -> JSONResponse:
    """A bounded view of the data: exact totals plus the newest few records of each kind."""
    try:
        store = get_store()
        counts = await asyncio.to_thread(store.library_counts)
        cvs = await asyncio.to_thread(store.recent_candidates, VIEW_SAMPLE)
        jds = await asyncio.to_thread(store.recent_job_descriptions, VIEW_SAMPLE)
        formatted_cvs = [{**c, "text_length": 0, "has_structured_data": True} for c in cvs]
        formatted_jds = [{**j, "text_length": 0, "has_structured_data": True} for j in jds]
        summary = {
            "total_documents": counts["cvs"] + counts["jds"],
            "total_cvs": counts["cvs"],
            "total_jds": counts["jds"],
            "shown_per_list": VIEW_SAMPLE,
            "avg_cv_skills": (sum(c["skills_count"] for c in formatted_cvs) / len(formatted_cvs)) if formatted_cvs else 0,
            "avg_jd_skills": (sum(j["required_skills"] for j in formatted_jds) / len(formatted_jds)) if formatted_jds else 0,
            "ready_for_matching": counts["cvs"] > 0 and counts["jds"] > 0,
        }
        return JSONResponse({"success": True, "data": {"cvs": formatted_cvs, "jds": formatted_jds, "summary": summary}, "timestamp": time.time()})
    except Exception as e:
        logger.error(f"Failed to get database view: {e}")
        raise HTTPException(status_code=500, detail="Database view error. Please try again or contact support.")
