"""
Enhanced Matching with LLM Analysis

This module adds LLM contextual analysis to semantic matching results.
The top candidates (LLM_MATCH_TOP_N, default 30) are analysed in batches of LLM_MATCH_BATCH_SIZE CVs per request.
Batches run concurrently, bounded process-wide by LLM_MATCH_CONCURRENCY so many simultaneous matches queue for the
API instead of bursting past its rate limits. One failed batch falls back to semantic scores for its own CVs only;
it neither loses the other batches nor gets cached.
"""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List
from app.config.settings import settings
from app.matching.llm_scoring import get_llm_matching_service
from app.store import get_store

logger = logging.getLogger(__name__)

# Shared executor for the (blocking) OpenAI batch calls. Its size is the process-wide cap on parallel LLM requests,
# whatever number of matches are running.
_llm_bulk_executor = ThreadPoolExecutor(max_workers=max(1, settings.LLM_MATCH_CONCURRENCY),
                                        thread_name_prefix="llm_bulk")

# Cache namespace + TTL for per-(jd, cv) LLM analyses. Caching makes the enhanced
# match score reproducible: once a (jd_id, cv_id) pair is analyzed, the SAME llm_score
# is returned on every subsequent match, so matching the same JD+CV from the Careers,
# Match or Database pages always yields the identical score.
_LLM_MATCH_NS = "llm_match_v2"   # v2: detailed analysis; v1 entries (short analyses) are ignored
_LLM_MATCH_TTL = 60 * 60 * 24 * 30  # 30 days


def _llm_match_cache_key(jd_id: str, cv_id: str) -> str:
    return f"{jd_id}|{cv_id}"


def _llm_match_cache_get(jd_id: str, cv_id: str):
    try:
        from app.providers.cache.redis import get_redis_cache
        return get_redis_cache().get(_llm_match_cache_key(jd_id, cv_id), namespace=_LLM_MATCH_NS)
    except Exception:
        return None


def _llm_match_cache_set(jd_id: str, cv_id: str, analysis: dict) -> None:
    try:
        from app.providers.cache.redis import get_redis_cache
        get_redis_cache().set(
            _llm_match_cache_key(jd_id, cv_id), analysis,
            ttl_seconds=_LLM_MATCH_TTL, namespace=_LLM_MATCH_NS,
        )
    except Exception:
        return None


async def _analyze_in_batches(llm_service, jd_raw_text: str, candidates: List[dict], batch_size: int,
                              on_batch=None) -> List[dict]:
    """Split candidates into batches, analyse them concurrently, return analyses in the original order.

    A batch that comes back entirely as fallbacks (the call failed) is retried once before giving up on it.
    ``on_batch(done, total)`` is called each time a batch finishes, so progress reflects real work.
    """
    size = max(1, batch_size)
    batches = [candidates[i:i + size] for i in range(0, len(candidates), size)]
    loop = asyncio.get_running_loop()

    async def run(batch: List[dict]) -> List[dict]:
        for attempt in (1, 2):
            result = await loop.run_in_executor(
                _llm_bulk_executor, lambda: llm_service.analyze_cv_jd_fit_bulk(jd_raw_text, batch))
            if not all(a.get("fallback") for a in result):
                return result
            if attempt == 1:
                logger.warning(f"LLM batch of {len(batch)} failed; retrying once")
        return result

    finished = 0

    async def run_and_report(batch: List[dict]) -> List[dict]:
        nonlocal finished
        result = await run(batch)
        finished += 1
        if on_batch:
            try:
                on_batch(finished, len(batches))
            except Exception:  # noqa: BLE001 - progress reporting never breaks the analysis
                pass
        return result

    results = await asyncio.gather(*(run_and_report(b) for b in batches))
    logger.info(f"LLM analysis: {len(candidates)} CVs in {len(batches)} batch(es) of up to {size}")
    return [a for batch_result in results for a in batch_result]


async def enhance_with_llm_analysis_batched(
    semantic_results: List[dict],
    jd_id: str,
    batch_size: int = 0,
    on_batch=None,
) -> List[dict]:
    """
    Enhance top candidates with LLM contextual analysis.
    Analyses the top LLM_MATCH_TOP_N (30) candidates in concurrent batches with GPT-4.1-mini.

    Per-(jd_id, cv_id) analyses are cached so the refined score is deterministic and
    identical across the Careers / Match / Database matching entry points.

    Args:
        semantic_results: List of semantic matching results sorted by score
        jd_id: Job description ID
        batch_size: CVs per LLM request (0 = LLM_MATCH_BATCH_SIZE)
        on_batch: optional ``(done, total)`` callback fired as each LLM batch finishes

    Returns:
        Enhanced results with LLM analysis for top min(30, len(results)) candidates
    """
    try:
        total_candidates = len(semantic_results)
        llm_analyze_count = min(max(1, settings.LLM_MATCH_TOP_N), total_candidates)

        if llm_analyze_count == 0:
            return semantic_results

        logger.info(f"Starting LLM analysis (batched requests) for top {llm_analyze_count}/{total_candidates} candidates")

        store = get_store()

        # Fetch JD raw text (one document)
        jd_doc = store.jd_document(jd_id)
        if not jd_doc:
            logger.warning(f"JD {jd_id} not found, skipping LLM analysis")
            for result in semantic_results:
                result["has_llm_analysis"] = False
            return semantic_results
        jd_raw_text = jd_doc["raw_text"]
        if not jd_raw_text or len(jd_raw_text.strip()) < 50:
            logger.warning(f"JD {jd_id} has no usable raw text, skipping LLM analysis")
            for result in semantic_results:
                result["has_llm_analysis"] = False
            return semantic_results

        # Fetch all top CV raw texts in one batch
        top_candidates = semantic_results[:llm_analyze_count]

        # First, serve any cached analyses so identical (jd, cv) pairs never re-score.
        analysis_by_idx: Dict[int, dict] = {}
        miss_indices: List[int] = []
        for i, r in enumerate(top_candidates):
            cached = _llm_match_cache_get(jd_id, str(r["cv_id"]))
            if cached is not None:
                analysis_by_idx[i] = cached
            else:
                miss_indices.append(i)

        if miss_indices:
            cv_ids = [top_candidates[i]["cv_id"] for i in miss_indices]
            cv_docs = store.candidate_documents(cv_ids)

            candidates_for_bulk = []
            for idx in miss_indices:
                r = top_candidates[idx]
                cv_id = r["cv_id"]
                cv_raw = (cv_docs.get(str(cv_id)) or {}).get("raw_text") or ""
                candidates_for_bulk.append({
                    "cv_id": cv_id,
                    "cv_raw_text": cv_raw,
                    "semantic_score": float(r.get("overall_score", 0)) * 100,
                    "requirements_note": r.get("requirements_note", ""),
                })

            # Batched LLM calls (only for the cache misses), run concurrently
            llm_service = get_llm_matching_service()
            analyses = await _analyze_in_batches(
                llm_service, jd_raw_text, candidates_for_bulk, batch_size or settings.LLM_MATCH_BATCH_SIZE, on_batch)
            for j, idx in enumerate(miss_indices):
                if j < len(analyses):
                    analysis_by_idx[idx] = analyses[j]
                    if not analyses[j].get("fallback"):  # never cache a failure for 30 days
                        _llm_match_cache_set(jd_id, str(top_candidates[idx]["cv_id"]), analyses[j])

        # Merge analyses back into results (same order)
        for i, result in enumerate(top_candidates):
            analysis = analysis_by_idx.get(i)
            if analysis is not None:
                result["llm_analysis"] = analysis
                result["has_llm_analysis"] = True
                if analysis.get("llm_score") is not None:
                    result["llm_score"] = analysis["llm_score"] / 100.0
                    result["semantic_score"] = result["overall_score"]
                    result["overall_score"] = result["llm_score"]
            else:
                result["has_llm_analysis"] = False

        for result in semantic_results[llm_analyze_count:]:
            result["has_llm_analysis"] = False

        logger.info(f"LLM analysis completed: {llm_analyze_count} analyzed ({len(miss_indices)} new, {llm_analyze_count - len(miss_indices)} cached)")
        return semantic_results

    except Exception as e:
        logger.error(f"LLM enhancement failed: {e}")
        for result in semantic_results:
            result["has_llm_analysis"] = False
        return semantic_results
