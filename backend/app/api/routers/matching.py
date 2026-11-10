"""Matching endpoints: queue-backed CV <-> JD matching (enqueue, progress, job status) and category matching.

The CPU-bound work runs in the match-worker container (app/jobs/match_worker.py), never in the API process.
Uses *_structured for standardized JSON and *_embeddings for the exact 31 vectors.
"""
import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api.deps import require_core_app
from app.config.settings import settings
from app.jobs import match_queue
from app.matching.engine import get_matching_service
from app.matching.runner import run_match
from app.models.user import User
from app.schemas.matching import MatchRequest as NewMatchRequest, MatchResponse, MatchWeights

logger = logging.getLogger(__name__)

router = APIRouter()

# ----------------------------
# Models for legacy endpoints
# ----------------------------
class TopCandidatesRequest(BaseModel):
    jd_id: str
    limit: Optional[int] = 10


# ----------------------------
# Matching endpoints (legacy)
# ----------------------------

# ----------------------------
# Matching, queue-backed (see app/jobs/match_queue.py and app/jobs/match_worker.py). The CPU-bound work runs in the match-worker
# container, never in the API process.
# ----------------------------
def _match_ceiling_error(count: int) -> Optional[str]:
    """Return an error string if `count` exceeds the safety ceiling, else None."""
    ceiling = settings.MATCH_MAX_CVS
    if ceiling and count > ceiling:
        return (
            f"A match can score at most {ceiling:,} CVs, and this request has {count:,}. "
            f"Select fewer CVs (or a category) and run it again."
        )
    return None


@router.get("/matching-progress/{job_id}")
async def get_matching_progress(job_id: str, _: User = Depends(require_core_app)):
    """Progress for a queued matching job (kept for backwards compatibility)."""
    job = await asyncio.to_thread(match_queue.get_job, job_id)
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

    # ---- optional safety ceiling for an explicit CV list (0 = none: matches stream in chunks, any size works) ----
    if req.cv_ids:
        err = _match_ceiling_error(len(req.cv_ids))
        if err:
            raise HTTPException(status_code=400, detail=err)

    weights = req.weights.dict() if req.weights else None

    # ---- queued job: any number of users may match at once; the queue absorbs the burst ----
    if settings.ENABLE_MATCH_QUEUE and not match_queue.is_match_queue_enabled():
        # Matching is CPU-heavy, so it is never run inside the API process when it is meant to be queued.
        raise HTTPException(status_code=503, detail="The matching queue is temporarily unavailable. Please retry shortly.",
                            headers={"Retry-After": "15"})
    if match_queue.is_match_queue_enabled():
        try:
            # Redis calls are blocking; keep them off the event loop so other users' requests are not stalled.
            job = await asyncio.to_thread(
                match_queue.enqueue_match,
                jd_id=req.jd_id, jd_text=req.jd_text, cv_ids=req.cv_ids, weights=weights,
                requested_by=getattr(_, "username", "") or "",
            )
        except match_queue.QueueFull as e:
            raise HTTPException(status_code=429, detail=str(e), headers={"Retry-After": str(e.retry_after)})
        except Exception as e:
            logger.error(f"Match enqueue failed ({e}); running inline")
        else:
            status = job.get("status")
            if status == "completed" and job.get("result"):
                # The stored result was produced from a MatchResponse; send it as-is. Re-validating ~15,000 candidates into
                # pydantic objects per download used to cost the API hundreds of MB per concurrent viewer.
                return JSONResponse(job["result"])
            if status == "failed":
                raise HTTPException(status_code=500, detail=job.get("error") or "Matching failed")

            pos = await asyncio.to_thread(match_queue.queue_position, job["job_id"]) or 0
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

    # ---- inline: only when the queue is switched off in configuration (local development) ----
    try:
        return await asyncio.wait_for(
            run_match(jd_id=req.jd_id, jd_text=req.jd_text, cv_ids=req.cv_ids, weights=weights),
            timeout=settings.MATCHING_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Matching timed out")
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Inline matching failed: {e}")
        raise HTTPException(status_code=500, detail="Matching error. Please try again or contact support.")


@router.get("/match/jobs/{job_id}", response_model=MatchResponse)
async def get_match_job(job_id: str, _: User = Depends(require_core_app)):
    """Explicit status/result endpoint for a queued matching job."""
    job = await asyncio.to_thread(match_queue.get_job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found")

    status = job.get("status")
    if status == "completed" and job.get("result"):
        # The stored result was produced from a MatchResponse; send it as-is. Re-validating ~15,000 candidates into
        # pydantic objects per download used to cost the API hundreds of MB per concurrent viewer.
        return JSONResponse(job["result"])
    if status == "failed":
        raise HTTPException(status_code=500, detail=job.get("error") or "Matching failed")

    pos = await asyncio.to_thread(match_queue.queue_position, job_id) or 0
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
        logger.error(f"Category-based matching failed: {e}")
        raise HTTPException(status_code=500, detail="Category-based matching failed. Please try again or contact support.")
