"""System endpoints: health check, system stats, and database introspection / maintenance."""
import logging
import time
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.api.deps import require_admin
from app.config.settings import settings
from app.models.user import User
from app.providers.cache.memory import get_cache_service
from app.providers.embeddings.service import get_embedding_service
from qdrant_client.models import Direction, OrderBy
from app.providers.vectorstore.qdrant import CV_PAYLOAD, get_qdrant_utils

logger = logging.getLogger(__name__)

router = APIRouter()

def _scroll_all(collection: str, with_vectors: bool = False, limit: int = 500) -> List[Any]:
    qdrant = get_qdrant_utils().client
    out, offset = [], None
    while True:
        points, next_off = qdrant.scroll(
            collection_name=collection,
            limit=limit,
            offset=offset,
            with_payload=CV_PAYLOAD if collection == "cv_structured" else True,
            with_vectors=with_vectors,
        )
        out.extend(points or [])
        if not next_off:
            break
        offset = next_off
    return out

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
            q = get_qdrant_utils()
            status["services"]["qdrant"] = q.health_check()
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
    Count items and provide light analytics.
    OPTIMIZED: Uses Qdrant collection info for instant counts, samples for analytics if needed.
    """
    try:
        q = get_qdrant_utils().client
        
        # OPTIMIZED: Get counts instantly from collection info (no scrolling needed)
        cv_collection = q.get_collection("cv_structured")
        jd_collection = q.get_collection("jd_structured")
        total_cvs = cv_collection.points_count
        total_jds = jd_collection.points_count
        
        # For skills analytics, sample a subset if collection is large (faster)
        # Sample up to 100 CVs/JDs for analytics calculation (representative sample)
        def _skills_count_sampled(collection_name: str, total_count: int):
            """Calculate skills stats from a sample for performance"""
            if total_count == 0:
                return []
            
            sample_size = min(100, total_count)  # Sample up to 100 items
            
            if sample_size >= total_count:
                # Small collection, get all
                points = _scroll_all(collection_name, with_vectors=False, limit=500)
            else:
                # Large collection, sample randomly
                # Get a random sample by scrolling with offset
                import random
                offset = random.randint(0, max(0, total_count - sample_size))
                scroll_result = q.scroll(
                    collection_name=collection_name,
                    limit=sample_size,
                    offset=offset,
                    with_payload=True,
                    with_vectors=False
                )
                points = scroll_result[0] or []
            
            vals = []
            for p in points:
                info = (p.payload or {}).get("structured_info", p.payload or {})
                vals.append(len(info.get("skills", [])))
            return vals
        
        # Calculate skills analytics from sample (fast, representative)
        cv_sk_counts = _skills_count_sampled("cv_structured", total_cvs)
        jd_sk_counts = _skills_count_sampled("jd_structured", total_jds)
        
        stats = {
            "database_stats": {
                "total_cvs": total_cvs,
                "total_jds": total_jds,
                "total_documents": total_cvs + total_jds,
            },
            "cv_analytics": {
                "total_cvs": total_cvs,
                "avg_skills_per_cv": (sum(cv_sk_counts) / len(cv_sk_counts)) if cv_sk_counts else 0,
                "max_skills_per_cv": max(cv_sk_counts) if cv_sk_counts else 0,
                "min_skills_per_cv": min(cv_sk_counts) if cv_sk_counts else 0,
            },
            "jd_analytics": {
                "total_jds": total_jds,
                "avg_skills_per_jd": (sum(jd_sk_counts) / len(jd_sk_counts)) if jd_sk_counts else 0,
                "max_skills_per_jd": max(jd_sk_counts) if jd_sk_counts else 0,
                "min_skills_per_jd": min(jd_sk_counts) if jd_sk_counts else 0,
            },
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
        raise HTTPException(status_code=500, detail=f"Failed to gather system stats: {str(e)}")

# ----------------------------
# DB Introspection
# ----------------------------
@router.get("/database/status")
async def get_database_status(_: User = Depends(require_admin)):
    try:
        q = get_qdrant_utils().client
        cols = q.get_collections()
        collections = []
        for c in cols.collections:
            name = c.name
            info = q.get_collection(name)
            # Vector config (single or multi)
            vectors = info.config.params.vectors
            if hasattr(vectors, "size"):
                vector_config = {"size": vectors.size, "distance": str(vectors.distance)}
            else:
                vector_config = {n: {"size": v.size, "distance": str(v.distance)} for n, v in vectors.items()}
            collections.append({
                "name": name,
                "points_count": info.points_count,
                "vector_config": vector_config,
                "status": str(info.status),
                "indexed_vectors_count": info.indexed_vectors_count,
            })
        return JSONResponse({
            "status": "success",
            "collections": collections,
            "total_collections": len(collections),
            "timestamp": time.time(),
        })
    except Exception as e:
        logger.error(f"Failed to get database status: {e}")
        raise HTTPException(status_code=500, detail=f"Database status error: {str(e)}")


VIEW_SAMPLE = 50   # records per list in the database view


def _recent_points(collection: str, n: int) -> List[Any]:
    """The newest ``n`` records of a collection (CVs by their indexed uploaded_at; others as stored)."""
    client = get_qdrant_utils().client
    try:
        if collection == "cv_structured":
            points, _ = client.scroll(collection, limit=n, order_by=OrderBy(key="uploaded_at", direction=Direction.DESC),
                                      with_payload=True, with_vectors=False)
            if points:
                return points
        points, _ = client.scroll(collection, limit=n, with_payload=True, with_vectors=False)
        return points
    except Exception as e:  # noqa: BLE001
        logger.warning(f"recent records of {collection} unavailable: {e}")
        return []


@router.get("/database/view")
async def view_database(_: User = Depends(require_admin)) -> JSONResponse:
    """
    Formatted DB view using *_structured collections.
    """
    try:
        # A bounded view: exact totals from Qdrant's counters plus the newest few records. It used to read EVERY CV and
        # JD in the database into one response, which does not survive a large database.
        q_client = get_qdrant_utils().client
        total_cv_count = int(q_client.count("cv_structured", exact=True).count)
        total_jd_count = int(q_client.count("jd_structured", exact=True).count)
        cvs = _recent_points("cv_structured", VIEW_SAMPLE)
        jds = _recent_points("jd_structured", VIEW_SAMPLE)
        formatted_cvs = []
        for p in cvs:
            pl = p.payload or {}
            s = pl.get("structured_info", pl)
            formatted_cvs.append({
                "id": str(p.id),
                "name": s.get("full_name", s.get("name", "Unknown")),
                "filename": s.get("filename", "Unknown"),
                "job_title": s.get("job_title", "Not specified"),
                "skills_count": len(s.get("skills", [])),
                "experience_years": s.get("experience_years", "Not specified"),
                "upload_date": s.get("upload_date", "Unknown"),
                "text_length": len(s.get("extracted_text", "")) if s.get("extracted_text") else 0,
                "top_skills": (s.get("skills", [])[:5]),
                "responsibilities_count": len(s.get("responsibilities", s.get("responsibility_sentences", []))),
                "has_structured_data": True,
            })
        formatted_jds = []
        for p in jds:
            pl = p.payload or {}
            s = pl.get("structured_info", pl)
            formatted_jds.append({
                "id": str(p.id),
                "filename": s.get("filename", "Unknown"),
                "job_title": s.get("job_title", "Not specified"),
                "required_skills": len(s.get("skills", [])),
                "required_years": s.get("experience_years", "Not specified"),
                "upload_date": s.get("upload_date", "Unknown"),
                "text_length": len(s.get("extracted_text", "")) if s.get("extracted_text") else 0,
                "top_skills": (s.get("skills", [])[:5]),
                "responsibilities_count": len(s.get("responsibilities", s.get("responsibility_sentences", []))),
                "has_structured_data": True,
            })
        formatted_cvs.sort(key=lambda x: x["upload_date"], reverse=True)
        formatted_jds.sort(key=lambda x: x["upload_date"], reverse=True)
        summary = {
            "total_documents": total_cv_count + total_jd_count,
            "total_cvs": total_cv_count,
            "total_jds": total_jd_count,
            "shown_per_list": VIEW_SAMPLE,
            "avg_cv_skills": (sum(c["skills_count"] for c in formatted_cvs) / len(formatted_cvs)) if formatted_cvs else 0,
            "avg_jd_skills": (sum(j["required_skills"] for j in formatted_jds) / len(formatted_jds)) if formatted_jds else 0,
            "ready_for_matching": total_cv_count > 0 and total_jd_count > 0,
        }
        return JSONResponse({
            "success": True,
            "data": {"cvs": formatted_cvs, "jds": formatted_jds, "summary": summary},
            "timestamp": time.time(),
        })
    except Exception as e:
        logger.error(f"Failed to get database view: {e}")
        raise HTTPException(status_code=500, detail=f"Database view error: {str(e)}")
