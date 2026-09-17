"""
Special Routes - Matching, Health, System & DB Introspection
Uses:
  - *_structured for standardized JSON
  - *_embeddings for EXACT 32 vectors
  - *_documents for raw files/text payloads
"""
import asyncio
import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.config import settings
from app.deps.auth import require_admin, require_core_app
from app.models.user import User
from app.services.ai.matching_service import get_matching_service
from app.services.ai.embedding_service import get_embedding_service
from app.services.ai.llm_service import get_llm_service
from app.utils.qdrant_utils import get_qdrant_utils
from app.utils.cache import get_cache_service
from app.schemas.matching import (
    MatchRequest as NewMatchRequest,
    MatchResponse,
    CandidateBreakdown,
    AssignmentItem,
    AlternativesItem,
    MatchWeights,
)
from app.utils.llm_enhancement import enhance_with_llm_analysis_batched
import numpy as np
logger = logging.getLogger(__name__)
router = APIRouter()

# ----------------------------
# Models for legacy endpoints
# ----------------------------
class TopCandidatesRequest(BaseModel):
    jd_id: str
    limit: Optional[int] = 10

# ----------------------------
# Helpers
# ----------------------------
def normalize_weights(weights: Dict[str, float]) -> Dict[str, float]:
    """Normalize weights to sum to 1.0"""
    total = sum(weights.values())
    if total <= 0:
        return {"skills": 0.25, "responsibilities": 0.25, "job_title": 0.25, "experience": 0.25}
    return {k: v / total for k, v in weights.items()}

def safe_parse_years(years_value) -> int:
    """Safely parse years of experience, handling string values like 'Not specified' or '5-8'."""
    if not years_value:
        return 0
    if isinstance(years_value, (int, float)):
        return int(years_value)
    if isinstance(years_value, str):
        s = years_value.strip()
        if not s or s.lower() in {"not specified", "x years", "not applicable", "n/a"}:
            return 0
        if "-" in s:
            try:
                return int(s.split("-")[0].strip())
            except Exception:
                return 0
        try:
            s = s.replace(" years", "").replace("+", "").strip()
            return int(s)
        except Exception:
            return 0
    return 0

def _scroll_all(collection: str, with_vectors: bool = False, limit: int = 500) -> List[Any]:
    qdrant = get_qdrant_utils().client
    out, offset = [], None
    while True:
        points, next_off = qdrant.scroll(
            collection_name=collection,
            limit=limit,
            offset=offset,
            with_payload=True,
            with_vectors=with_vectors,
        )
        out.extend(points or [])
        if not next_off:
            break
        offset = next_off
    return out

def _get_structured_cv(cv_id: str) -> Optional[Dict[str, Any]]:
    q = get_qdrant_utils().client
    res = q.retrieve("cv_structured", ids=[cv_id], with_payload=True, with_vectors=False)
    if not res:
        return None
    payload = res[0].payload or {}
    info = payload.get("structured_info", payload)
    # Normalize keys used by UI
    return {
        "id": cv_id,
        "name": info.get("full_name", info.get("name", cv_id)),
        "job_title": info.get("job_title", ""),
        "years_of_experience": info.get("years_of_experience", info.get("experience_years", 0)),
        "skills": info.get("skills", []),
        "responsibilities": info.get("responsibilities", info.get("responsibility_sentences", [])),
        "structured_info": info,
    }

def _get_structured_jd(jd_id: str) -> Optional[Dict[str, Any]]:
    q = get_qdrant_utils().client
    res = q.retrieve("jd_structured", ids=[jd_id], with_payload=True, with_vectors=False)
    if not res:
        return None
    payload = res[0].payload or {}
    info = payload.get("structured_info", payload)
    return {
        "id": jd_id,
        "job_title": info.get("job_title", ""),
        "years_of_experience": info.get("years_of_experience", info.get("experience_years", 0)),
        "skills": info.get("skills", []),
        "responsibilities": info.get("responsibilities", info.get("responsibility_sentences", [])),
        "structured_info": info,
    }

# ----------------------------
# Matching endpoints (legacy)
# ----------------------------

# ----------------------------
# Matching — queue-backed (see app/services/queue/match_queue.py and
# app/worker/match_worker.py). The CPU-bound work runs in the match-worker
# container, never in the API process.
# ----------------------------
from app.services.ai.match_runner import run_match
from app.services.queue import match_queue

# Bounds the *inline fallback* path only (queue disabled / Redis down). The queue
# path enforces its own global concurrency cap across worker replicas.
_inline_match_semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_MATCHES)


def _match_ceiling_error(count: int) -> Optional[str]:
    """Return an error string if `count` exceeds the safety ceiling, else None."""
    ceiling = settings.MATCH_MAX_CVS
    if ceiling and count > ceiling:
        return (
            f"This request targets {count} CVs, which is above the current safety "
            f"ceiling of {ceiling} per matching job. Split it into smaller batches."
        )
    return None


@router.get("/matching-progress/{job_id}")
async def get_matching_progress(job_id: str, _: User = Depends(require_core_app)):
    """Progress for a queued matching job (kept for backwards compatibility)."""
    job = match_queue.get_job(job_id)
    progress = (job or {}).get("progress", {}) if job else {}
    return JSONResponse({
        "job_id": job_id,
        "status": (job or {}).get("status", "not_found"),
        "phase": progress.get("phase"),
        "progress_percent": progress.get("progress_percent", 0),
        "total_candidates": progress.get("total_candidates", 0),
        "processed_candidates": progress.get("processed_candidates", 0),
        "current_chunk": progress.get("current_chunk", 0),
        "total_chunks": progress.get("total_chunks", 0),
        "results_so_far": progress.get("results_so_far", 0),
        "current_candidate": progress.get("current_candidate"),
        "recent": progress.get("recent", []),
        "error": (job or {}).get("error"),
    })

# ----------------------------
# Real-time text / DB match  ->  Redis queue  ->  match-worker
# ----------------------------

@router.post("/match", response_model=MatchResponse)
async def match_candidates(req: NewMatchRequest, _: User = Depends(require_core_app)):
    """
    Deterministic, explainable matching (Hungarian assignment on the stored
    32-vector representation). The heavy work is handed to the ``match-worker``
    container via a Redis queue so it never blocks the API.

    Contract (unchanged for the frontend):
      * First call enqueues the job and returns ``is_queued=True`` with a
        ``queue_position`` / ``estimated_wait_time`` / ``job_id``.
      * Re-POSTing the *same* request re-attaches to that job. While it is still
        running you get ``is_queued=True`` again; once it finishes you get the
        full ``MatchResponse`` with ``candidates``.
      * ``GET /api/match/jobs/{job_id}`` exposes the same state explicitly.
    """
    if not (req.jd_id or req.jd_text):
        raise HTTPException(status_code=400, detail="Provide jd_id or jd_text")

    # ---- safety ceiling (no more small hard cap; this only stops absurd jobs) ----
    if req.cv_ids:
        err = _match_ceiling_error(len(req.cv_ids))
        if err:
            raise HTTPException(status_code=400, detail=err)
    else:
        try:
            total_in_db = get_qdrant_utils().client.get_collection("cv_structured").points_count or 0
            err = _match_ceiling_error(int(total_in_db))
            if err:
                raise HTTPException(status_code=400, detail=err)
        except HTTPException:
            raise
        except Exception:
            pass  # counting is best-effort; the worker still streams in chunks

    weights = req.weights.dict() if req.weights else None

    # ---- fast path: queued job ----
    if match_queue.is_match_queue_enabled():
        try:
            job = match_queue.enqueue_match(
                jd_id=req.jd_id, jd_text=req.jd_text, cv_ids=req.cv_ids, weights=weights,
                requested_by=getattr(_, "username", "") or "",
            )
        except Exception as e:
            logger.error(f"⚠️ Match enqueue failed ({e}); running inline")
        else:
            status = job.get("status")
            if status == "completed" and job.get("result"):
                return MatchResponse(**job["result"])
            if status == "failed":
                raise HTTPException(status_code=500, detail=job.get("error") or "Matching failed")

            pos = match_queue.queue_position(job["job_id"]) or 0
            return MatchResponse(
                jd_id=req.jd_id,
                jd_job_title=None,
                jd_years=0,
                normalized_weights=MatchWeights(),
                candidates=[],
                is_queued=True,
                job_id=job["job_id"],
                status=status,
                progress=job.get("progress"),
                queue_position=pos or None,
                estimated_wait_time=match_queue.estimate_wait_seconds(pos),
                message=(
                    "Matching is running in the background."
                    if status == "processing"
                    else f"Queued at position {pos or 1}. This page will update automatically."
                ),
            )

    # ---- fallback: run inline (queue disabled or Redis unreachable) ----
    async with _inline_match_semaphore:
        try:
            resp = await asyncio.wait_for(
                run_match(
                    jd_id=req.jd_id, jd_text=req.jd_text, cv_ids=req.cv_ids, weights=weights,
                ),
                timeout=settings.MATCHING_TIMEOUT_SECONDS,
            )
            return resp
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Matching timed out")
        except HTTPException:
            raise
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.error(f"❌ Inline matching failed: {e}")
            raise HTTPException(status_code=500, detail=f"Matching error: {str(e)}")


@router.get("/match/jobs/{job_id}", response_model=MatchResponse)
async def get_match_job(job_id: str, _: User = Depends(require_core_app)):
    """Explicit status/result endpoint for a queued matching job."""
    job = match_queue.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found")

    status = job.get("status")
    if status == "completed" and job.get("result"):
        return MatchResponse(**job["result"])
    if status == "failed":
        raise HTTPException(status_code=500, detail=job.get("error") or "Matching failed")

    pos = match_queue.queue_position(job_id) or 0
    return MatchResponse(
        jd_id=(job.get("params") or {}).get("jd_id"),
        normalized_weights=MatchWeights(),
        candidates=[],
        is_queued=True,
        job_id=job_id,
        status=status,
        progress=job.get("progress"),
        queue_position=pos or None,
        estimated_wait_time=match_queue.estimate_wait_seconds(pos),
        message="Matching is running in the background." if status == "processing"
                else f"Queued at position {pos or 1}.",
    )


# ----------------------------
# Health & system stats
# ----------------------------
@router.get("/health")
async def health_check() -> JSONResponse:
    """
    Verify services and DB connectivity.
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
            from app.utils.redis_cache import get_redis_cache
            redis_cache = get_redis_cache()
            status["services"]["cache"] = redis_cache.health_check()
        except Exception as e:
            # Fallback to in-memory cache
            try:
                cache = get_cache_service()
                status["services"]["cache"] = {"status": "healthy", "stats": cache.get_stats(), "type": "in-memory"}
            except Exception as e2:
                status["services"]["cache"] = {"status": "unhealthy", "error": str(e2)}
                status["status"] = "degraded"
        import os
        status["environment"] = {
            "openai_key_configured": bool(settings.OPENAI_API_KEY or os.getenv("OPENAI_API_KEY")),
            "qdrant_host": settings.QDRANT_HOST,
            "qdrant_port": str(settings.QDRANT_PORT),
        }
        return JSONResponse(status)
    except Exception as e:
        logger.error(f"❌ Health check failed: {e}")
        return JSONResponse(
            {"status": "unhealthy", "error": str(e), "timestamp": time.time()},
            status_code=500
        )

import shutil
import os

@router.post("/clear-database")
async def clear_database(confirm: bool = False, _: User = Depends(require_admin)) -> JSONResponse:
    """
    ADMIN ONLY - drops all Qdrant collections and recreates them.
    Requires admin role authentication.
    """
    try:
        if not confirm:
            raise HTTPException(status_code=400, detail="Set 'confirm=true' to proceed.")
        q = get_qdrant_utils()
        ok = q.clear_all_data()
        get_cache_service().clear()
        
        # Clear local file storage
        storage_dir = os.path.abspath("storage")
        if os.path.exists(storage_dir):
            try:
                # remove all contents but keep directory
                for filename in os.listdir(storage_dir):
                    file_path = os.path.join(storage_dir, filename)
                    try:
                        if os.path.isfile(file_path) or os.path.islink(file_path):
                            os.unlink(file_path)
                        elif os.path.isdir(file_path):
                            shutil.rmtree(file_path)
                    except Exception as e:
                        logger.error(f"Failed to delete {file_path}: {e}")
                logger.info("✅ Storage directory cleared")
            except Exception as e:
                logger.error(f"❌ Failed to clear storage directory: {e}")

        if ok:
            return JSONResponse({
                "status": "success",
                "message": "All data cleared from database and cache",
                "timestamp": time.time(),
            })
        raise HTTPException(status_code=500, detail="Failed to clear database")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Database clear failed: {e}")
        raise HTTPException(status_code=500, detail=f"Database clear failed: {str(e)}")

@router.get("/system-stats")
async def get_system_stats(_: User = Depends(require_core_app)) -> JSONResponse:
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
                "llm_model": "gpt-4.1-mini-2025-04-14",
                "similarity_metric": "cosine",
            },
        }
        return JSONResponse({"status": "success", "stats": stats, "timestamp": time.time()})
    except Exception as e:
        logger.error(f"❌ Failed to gather system stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to gather system stats: {str(e)}")

# ----------------------------
# DB Introspection
# ----------------------------
@router.get("/database/status")
async def get_database_status(_: User = Depends(require_core_app)):
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
        logger.error(f"❌ Failed to get database status: {e}")
        raise HTTPException(status_code=500, detail=f"Database status error: {str(e)}")


@router.get("/database/view")
async def view_database(_: User = Depends(require_core_app)) -> JSONResponse:
    """
    Formatted DB view using *_structured collections.
    """
    try:
        cvs = _scroll_all("cv_structured")
        jds = _scroll_all("jd_structured")
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
            "total_documents": len(formatted_cvs) + len(formatted_jds),
            "total_cvs": len(formatted_cvs),
            "total_jds": len(formatted_jds),
            "avg_cv_skills": (sum(c["skills_count"] for c in formatted_cvs) / len(formatted_cvs)) if formatted_cvs else 0,
            "avg_jd_skills": (sum(j["required_skills"] for j in formatted_jds) / len(formatted_jds)) if formatted_jds else 0,
            "ready_for_matching": bool(formatted_cvs) and bool(formatted_jds),
        }
        return JSONResponse({
            "success": True,
            "data": {"cvs": formatted_cvs, "jds": formatted_jds, "summary": summary},
            "timestamp": time.time(),
        })
    except Exception as e:
        logger.error(f"❌ Failed to get database view: {e}")
        raise HTTPException(status_code=500, detail=f"Database view error: {str(e)}")

@router.post("/match/category-based")
async def match_by_category(request: TopCandidatesRequest, _: User = Depends(require_core_app)):
    """
    Match candidates by automatically detecting JD category and filtering CVs by same category.
    This ensures only relevant CVs are matched against the job description.
    """
    try:
        matching_service = get_matching_service()
        results = matching_service.find_top_candidates_by_jd_category(
            jd_id=request.jd_id,
            limit=request.limit or 10
        )
        
        # Convert MatchResult objects to dictionaries
        formatted_results = []
        for result in results:
            formatted_results.append({
                "cv_id": result.cv_id,
                "jd_id": result.jd_id,
                "overall_score": result.overall_score,
                "skills_score": result.skills_score,
                "responsibilities_score": result.responsibilities_score,
                "title_score": result.title_score,
                "experience_score": result.experience_score,
                "explanation": result.explanation,
                "match_details": result.match_details,
                "processing_time": result.processing_time
            })
        
        return JSONResponse({
            "success": True,
            "data": {
                "matches": formatted_results,
                "total_matches": len(formatted_results),
                "jd_id": request.jd_id,
                "matching_strategy": "category-based"
            },
            "timestamp": time.time()
        })
    except Exception as e:
        logger.error(f"❌ Category-based matching failed: {e}")
        raise HTTPException(status_code=500, detail=f"Category-based matching failed: {str(e)}")
