"""Core CV↔JD matching orchestration.

This is the exact pipeline that used to live inline in ``special_routes.match_candidates``:
resolve the JD, gather candidates, score every CV with :class:`MatchingService`
(Hungarian assignment on the stored 32-vector representation), sort, run the
top-50 LLM enhancement and persist the scores.

The scoring algorithm, weights, thresholds, business rules and the LLM step are
**unchanged** — this module only moves the code out of the request handler so it
can run inside the dedicated ``match-worker`` process instead of the API worker,
and it batches the Qdrant reads that were previously done one CV at a time.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

from app.core.config import settings
from app.schemas.matching import (
    AssignmentItem,
    CandidateBreakdown,
    MatchResponse,
    MatchWeights,
)
from app.services.ai.embedding_service import get_embedding_service  # noqa: F401 (warm model)
from app.services.ai.llm_service import get_llm_service
from app.services.ai.matching_service import get_matching_service
from app.utils.llm_enhancement import enhance_with_llm_analysis_batched
from app.utils.qdrant_utils import get_qdrant_utils

logger = logging.getLogger(__name__)

ProgressCb = Callable[[Dict[str, Any]], None]

# Shared bounded executor for per-candidate scoring. Deliberately small so a
# match job never starves the rest of the box (see MATCH_THREAD_POOL_WORKERS).
_match_executor = ThreadPoolExecutor(
    max_workers=max(1, settings.MATCH_THREAD_POOL_WORKERS),
    thread_name_prefix="match_worker",
)


# ---------------------------------------------------------------------------
# Helpers (moved verbatim from special_routes)
# ---------------------------------------------------------------------------
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


async def process_single_candidate(
    candidate_data: dict, jd_structured: dict, matching_service, weights: dict,
    on_done: Optional[Callable[[str, str], None]] = None,
) -> Optional[dict]:
    """Process a single candidate asynchronously (heavy scoring runs in the thread pool).

    ``on_done(cv_id, cv_name)`` fires on the event-loop thread as soon as this
    candidate's score is ready (or has failed) so the UI can show live per-CV
    progress.
    """
    cv_id = candidate_data.get("id", "unknown")
    cv_name = candidate_data.get("name") or cv_id
    try:

        cv_title = candidate_data.get("job_title", "")
        cv_years = safe_parse_years(candidate_data.get("years_of_experience"))
        cv_skills = [s for s in candidate_data.get("skills_sentences", []) if s]
        cv_resps = [r for r in candidate_data.get("responsibility_sentences", []) if r]

        cv_structured = {
            "id": cv_id,
            "name": cv_name,
            "job_title": cv_title,
            "years_of_experience": cv_years,
            "skills": cv_skills,
            "responsibilities": cv_resps,
            "email": candidate_data.get("email", "") or "",
            "phone": candidate_data.get("phone", "") or "",
        }

        loop = asyncio.get_event_loop()
        if jd_structured.get("id") != "text_jd":
            match_result = await loop.run_in_executor(
                _match_executor, matching_service.match_by_ids, cv_id, jd_structured.get("id"), weights
            )
        else:
            match_result = await loop.run_in_executor(
                _match_executor, matching_service.match_structured_data, cv_structured, jd_structured, weights
            )

        return {
            "candidate_data": candidate_data,
            "match_result": match_result,
            "cv_structured": cv_structured,
        }
    except Exception as e:  # noqa: BLE001
        logger.error(f"❌ Failed to process candidate {cv_id}: {e}")
        return None
    finally:
        if on_done is not None:
            try:
                on_done(cv_id, cv_name)
            except Exception:  # progress reporting must never break a job
                pass


async def process_candidates_chunk_parallel(
    candidates_chunk: list, jd_structured: dict, matching_service, weights: dict,
    on_done: Optional[Callable[[str, str], None]] = None,
) -> list:
    """Score a chunk of candidates concurrently and convert to CandidateBreakdown."""
    try:
        tasks = [
            process_single_candidate(c, jd_structured, matching_service, weights, on_done)
            for c in candidates_chunk
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        resp_candidates: List[CandidateBreakdown] = []
        for result in results:
            if result is None or isinstance(result, Exception):
                continue

            match_result = result["match_result"]
            cv_structured = result["cv_structured"]

            skills_assignments = []
            if "skills_analysis" in match_result.match_details and "matches" in match_result.match_details["skills_analysis"]:
                for match in match_result.match_details["skills_analysis"]["matches"]:
                    skills_assignments.append(AssignmentItem(
                        type="skill",
                        jd_index=match.get("jd_index", 0),
                        jd_item=match.get("jd_skill", ""),
                        cv_index=match.get("cv_index", 0),
                        cv_item=match.get("cv_skill", ""),
                        score=match.get("similarity", 0.0),
                    ))

            responsibilities_assignments = []
            if "responsibilities_analysis" in match_result.match_details and "matches" in match_result.match_details["responsibilities_analysis"]:
                for match in match_result.match_details["responsibilities_analysis"]["matches"]:
                    responsibilities_assignments.append(AssignmentItem(
                        type="responsibility",
                        jd_index=match.get("jd_index", 0),
                        jd_item=match.get("jd_responsibility", ""),
                        cv_index=match.get("cv_index", 0),
                        cv_item=match.get("cv_responsibility", ""),
                        score=match.get("similarity", 0.0),
                    ))

            unmatched_jd_skills = match_result.match_details.get("skills_analysis", {}).get("unmatched_jd_skills", [])
            unmatched_jd_responsibilities = match_result.match_details.get("responsibilities_analysis", {}).get("unmatched_jd_responsibilities", [])

            resp_candidates.append(CandidateBreakdown(
                cv_id=cv_structured["id"],
                cv_name=cv_structured["name"],
                cv_job_title=cv_structured["job_title"],
                cv_years=cv_structured["years_of_experience"],
                cv_email=cv_structured.get("email") or "",
                cv_phone=cv_structured.get("phone") or "",
                expected_salary=cv_structured.get("expected_salary"),
                skills_score=match_result.skills_score / 100.0,
                responsibilities_score=match_result.responsibilities_score / 100.0,
                job_title_score=match_result.title_score / 100.0,
                years_score=match_result.experience_score / 100.0,
                overall_score=match_result.overall_score / 100.0,
                skills_assignments=skills_assignments,
                responsibilities_assignments=responsibilities_assignments,
                unmatched_jd_skills=unmatched_jd_skills,
                unmatched_jd_responsibilities=unmatched_jd_responsibilities,
                skills_alternatives=[],
                responsibilities_alternatives=[],
            ))

        return resp_candidates
    except Exception as e:  # noqa: BLE001
        logger.error(f"❌ Chunk processing failed: {e}")
        return []


# ---------------------------------------------------------------------------
# Candidate gathering (batched Qdrant reads)
# ---------------------------------------------------------------------------
def _gather_candidates(qdrant, cv_ids: Optional[List[str]]) -> List[dict]:
    """Return normalized structured CVs, fetched in batches instead of one-by-one."""
    batch = max(32, settings.MATCH_QDRANT_BATCH_SIZE)

    if cv_ids:
        ids = list(dict.fromkeys(cv_ids))  # de-dupe, preserve order
    else:
        ids = [m["id"] for m in qdrant.list_all_cvs()]
        logger.info(f"📊 Matching all CVs in database: {len(ids)} CVs")

    out: List[dict] = []
    for i in range(0, len(ids), batch):
        out.extend(qdrant.get_structured_cvs_batch(ids[i:i + batch]))
    return out


def _resolve_jd(qdrant, jd_id: Optional[str], jd_text: Optional[str]) -> dict:
    if not (jd_id or jd_text):
        raise ValueError("Provide jd_id or jd_text")
    if jd_id:
        jd = qdrant.get_structured_jd(jd_id)
        if not jd:
            raise ValueError("JD not found")
        return jd
    llm = get_llm_service()
    jd_std = llm.standardize_jd(jd_text, "jd_input.txt")
    return {
        "id": "text_jd",
        "job_title": jd_std.get("job_title", ""),
        "years_of_experience": jd_std.get("experience_years", 0),
        "skills_sentences": jd_std.get("skills", [])[:20],
        "responsibility_sentences": (jd_std.get("responsibilities", []) or jd_std.get("responsibility_sentences", []))[:10],
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
async def run_match(
    *,
    jd_id: Optional[str] = None,
    jd_text: Optional[str] = None,
    cv_ids: Optional[List[str]] = None,
    weights: Optional[Dict[str, float]] = None,
    progress_cb: Optional[ProgressCb] = None,
) -> MatchResponse:
    """Run the full matching pipeline and return a :class:`MatchResponse`.

    ``progress_cb`` (if given) is called with dicts like
    ``{"status": "...", "progress_percent": 42, "processed_candidates": ...}``.
    """
    def _progress(**kw: Any) -> None:
        if progress_cb:
            try:
                progress_cb(kw)
            except Exception:  # pragma: no cover - progress must never break a job
                pass

    t0 = time.time()
    qdrant = get_qdrant_utils()
    matching_service = get_matching_service()

    jd = _resolve_jd(qdrant, jd_id, jd_text)
    jd_title = jd.get("job_title") or ""
    jd_years = safe_parse_years(jd.get("years_of_experience"))
    jd_skills = [s for s in jd.get("skills_sentences", []) if s]
    jd_resps = [r for r in jd.get("responsibility_sentences", []) if r]

    _progress(status="processing", progress_percent=1, processed_candidates=0)

    candidates_meta = _gather_candidates(qdrant, cv_ids)
    if not candidates_meta:
        raise ValueError("No CVs available for matching")

    total_candidates = len(candidates_meta)
    logger.info(f"🎯 Matching {total_candidates} CVs with JD {jd.get('id')}")

    W = weights or MatchWeights().dict()
    Wn = normalize_weights(W)

    jd_structured = {
        "id": jd.get("id", "text_jd"),
        "job_title": jd_title,
        "years_of_experience": jd_years,
        "skills": jd_skills,
        "responsibilities": jd_resps,
    }

    chunk_size = max(1, settings.MATCH_CHUNK_SIZE)
    total_chunks = (total_candidates + chunk_size - 1) // chunk_size
    resp_candidates: List[CandidateBreakdown] = []

    # --- live per-CV progress -------------------------------------------------
    # process_single_candidate calls _on_candidate_done() on the event-loop
    # thread the moment each CV's score is ready, so the UI can show exactly
    # which candidate was just matched (and how many are done) in real time.
    scored_count = 0
    recent: "deque[Dict[str, str]]" = deque(maxlen=12)
    last_emit = 0.0

    def _emit_scoring(current_name: str = "") -> None:
        pct = 2 + (scored_count / max(1, total_candidates)) * 88
        _progress(
            status="processing", phase="scoring",
            total_candidates=total_candidates, total_chunks=total_chunks,
            current_chunk=(scored_count + chunk_size - 1) // chunk_size,
            processed_candidates=scored_count, results_so_far=scored_count,
            progress_percent=round(pct, 1),
            current_candidate=current_name,
            recent=list(recent),
        )

    def _on_candidate_done(cv_id: str, cv_name: str) -> None:
        nonlocal scored_count, last_emit
        scored_count += 1
        recent.appendleft({"cv_id": str(cv_id), "cv_name": str(cv_name)})
        now = time.time()
        # Throttle Redis writes: ~3/sec max, but never drop the final one.
        if scored_count == total_candidates or now - last_emit >= 0.35:
            last_emit = now
            _emit_scoring(cv_name)

    _progress(
        status="processing", phase="scoring", total_candidates=total_candidates,
        total_chunks=total_chunks, progress_percent=2, processed_candidates=0,
        current_chunk=0, recent=[],
    )

    for chunk_start in range(0, total_candidates, chunk_size):
        chunk = candidates_meta[chunk_start:chunk_start + chunk_size]
        chunk_number = chunk_start // chunk_size + 1

        chunk_results = await process_candidates_chunk_parallel(
            chunk, jd_structured, matching_service, Wn, _on_candidate_done
        )
        resp_candidates.extend(chunk_results)
        gc.collect()
        _emit_scoring()  # exact sync at every chunk boundary
        logger.info(f"✅ Chunk {chunk_number}/{total_chunks} done — {scored_count}/{total_candidates}")

    resp_candidates.sort(key=lambda x: x.overall_score, reverse=True)

    # ------- LLM enhancement for the top candidates (unchanged: top min(50, N)) -------
    if jd_id and resp_candidates:
        llm_n = min(50, len(resp_candidates))
        _progress(
            status="llm_enhancement", phase="llm_verification", progress_percent=92,
            total_candidates=total_candidates, processed_candidates=total_candidates,
            llm_total=llm_n,
            message=f"AI verification of the top {llm_n} candidates…",
            recent=[],
        )
        try:
            candidates_dict = [{
                "cv_id": c.cv_id, "cv_name": c.cv_name, "overall_score": c.overall_score,
                "skills_score": c.skills_score, "responsibilities_score": c.responsibilities_score,
                "job_title_score": c.job_title_score, "years_score": c.years_score,
            } for c in resp_candidates]

            enhanced_dict = await enhance_with_llm_analysis_batched(
                semantic_results=candidates_dict, jd_id=jd_id, batch_size=10
            )

            for i, candidate in enumerate(resp_candidates):
                enhanced_data = enhanced_dict[i]
                candidate.has_llm_analysis = enhanced_data.get("has_llm_analysis", False)
                if candidate.has_llm_analysis:
                    candidate.llm_analysis = enhanced_data.get("llm_analysis", {})
                    candidate.semantic_score = candidate.overall_score
                    if "llm_score" in enhanced_data:
                        candidate.overall_score = enhanced_data["llm_score"]

            resp_candidates.sort(key=lambda x: x.overall_score, reverse=True)
            llm_analyzed = sum(1 for c in resp_candidates if getattr(c, "has_llm_analysis", False))
            logger.info(f"✅ LLM enhancement complete: {llm_analyzed} candidates analyzed")
        except Exception as e:  # noqa: BLE001
            logger.error(f"❌ LLM enhancement failed: {e} - continuing with semantic scores only")

    # ------- persist scores -------
    if jd_id:
        try:
            score_map = {
                c.cv_id: {
                    "overall_score": float(c.overall_score),
                    "skills_score": float(c.skills_score),
                    "responsibilities_score": float(c.responsibilities_score),
                    "job_title_score": float(c.job_title_score),
                    "years_score": float(c.years_score),
                }
                for c in resp_candidates if getattr(c, "cv_id", None)
            }
            # Only writes onto CVs that actually applied to this job — an ad-hoc
            # match against an unrelated JD never touches their stored score.
            qdrant.store_applied_job_match_scores(jd_id, jd_title, score_map)
        except Exception as persist_err:  # noqa: BLE001
            logger.warning(f"⚠️ Could not persist match scores: {persist_err}")

    _progress(status="completed", phase="finalizing", progress_percent=100,
              total_candidates=total_candidates, processed_candidates=total_candidates,
              results_so_far=len(resp_candidates), recent=[])
    logger.info(f"🏁 Match finished in {time.time() - t0:.1f}s — {len(resp_candidates)} candidates")

    return MatchResponse(
        jd_id=jd_id,
        jd_job_title=jd_title,
        jd_years=jd_years,
        normalized_weights=MatchWeights(**Wn),
        candidates=resp_candidates,
        is_queued=False,
        queue_position=None,
        estimated_wait_time=None,
        message=None,
    )
