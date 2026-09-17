"""
Enhanced Matching with LLM Analysis

This module adds LLM contextual analysis to semantic matching results.
Uses a single bulk LLM call (all top candidates at once) with GPT-4.1-mini for efficiency.
"""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List
from app.services.ai.llm_matching_service import get_llm_matching_service
from app.utils.qdrant_utils import get_qdrant_utils, get_decompressed_content

logger = logging.getLogger(__name__)

# Single shared executor for the (blocking) bulk OpenAI call.
_llm_bulk_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="llm_bulk")

# Cache namespace + TTL for per-(jd, cv) LLM analyses. Caching makes the enhanced
# match score reproducible: once a (jd_id, cv_id) pair is analyzed, the SAME llm_score
# is returned on every subsequent match, so matching the same JD+CV from the Careers,
# Match or Database pages always yields the identical score.
_LLM_MATCH_NS = "llm_match"
_LLM_MATCH_TTL = 60 * 60 * 24 * 30  # 30 days


def _llm_match_cache_key(jd_id: str, cv_id: str) -> str:
    return f"{jd_id}|{cv_id}"


def _llm_match_cache_get(jd_id: str, cv_id: str):
    try:
        from app.utils.redis_cache import get_redis_cache
        return get_redis_cache().get(_llm_match_cache_key(jd_id, cv_id), namespace=_LLM_MATCH_NS)
    except Exception:
        return None


def _llm_match_cache_set(jd_id: str, cv_id: str, analysis: dict) -> None:
    try:
        from app.utils.redis_cache import get_redis_cache
        get_redis_cache().set(
            _llm_match_cache_key(jd_id, cv_id), analysis,
            ttl_seconds=_LLM_MATCH_TTL, namespace=_LLM_MATCH_NS,
        )
    except Exception:
        return None


async def enhance_with_llm_analysis_batched(
    semantic_results: List[dict],
    jd_id: str,
    batch_size: int = 10,
) -> List[dict]:
    """
    Enhance top candidates with LLM contextual analysis.
    Uses one bulk API call for all top candidates (up to 50) with GPT-4.1-mini.

    Per-(jd_id, cv_id) analyses are cached so the refined score is deterministic and
    identical across the Careers / Match / Database matching entry points.

    Args:
        semantic_results: List of semantic matching results sorted by score
        jd_id: Job description ID
        batch_size: Unused (kept for API compatibility); bulk path ignores it

    Returns:
        Enhanced results with LLM analysis for top min(50, len(results)) candidates
    """
    try:
        total_candidates = len(semantic_results)
        llm_analyze_count = min(50, total_candidates)

        if llm_analyze_count == 0:
            return semantic_results

        logger.info(f"🤖 Starting LLM analysis (single bulk request) for top {llm_analyze_count}/{total_candidates} candidates")

        qdrant = get_qdrant_utils()

        # Fetch JD raw text (one document)
        jd_docs = qdrant.client.retrieve("jd_documents", ids=[jd_id], with_payload=True, with_vectors=False)
        if not jd_docs or not jd_docs[0].payload:
            logger.warning(f"⚠️ JD {jd_id} not found, skipping LLM analysis")
            for result in semantic_results:
                result["has_llm_analysis"] = False
            return semantic_results
        jd_raw_text = get_decompressed_content(jd_docs[0].payload)
        if not jd_raw_text or len(jd_raw_text.strip()) < 50:
            logger.warning(f"⚠️ JD {jd_id} has no usable raw text, skipping LLM analysis")
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
            cv_docs = qdrant.client.retrieve("cv_documents", ids=cv_ids, with_payload=True, with_vectors=False)
            id_to_payload = {}
            if cv_docs:
                for i, point in enumerate(cv_docs):
                    if point.id is not None:
                        id_to_payload[str(point.id)] = point.payload or {}
                    elif i < len(cv_ids):
                        id_to_payload[cv_ids[i]] = point.payload or {}

            candidates_for_bulk = []
            for idx in miss_indices:
                r = top_candidates[idx]
                cv_id = r["cv_id"]
                payload = id_to_payload.get(str(cv_id)) or id_to_payload.get(cv_id) or {}
                cv_raw = get_decompressed_content(payload) or ""
                candidates_for_bulk.append({
                    "cv_id": cv_id,
                    "cv_raw_text": cv_raw,
                    "semantic_score": float(r.get("overall_score", 0)) * 100,
                })

            # Single bulk LLM call (only for the cache misses)
            llm_service = get_llm_matching_service()
            loop = asyncio.get_event_loop()
            analyses = await loop.run_in_executor(
                _llm_bulk_executor,
                lambda: llm_service.analyze_cv_jd_fit_bulk(jd_raw_text, candidates_for_bulk),
            )
            for j, idx in enumerate(miss_indices):
                if j < len(analyses):
                    analysis_by_idx[idx] = analyses[j]
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

        logger.info(f"🎉 LLM analysis completed: {llm_analyze_count} analyzed ({len(miss_indices)} new, {llm_analyze_count - len(miss_indices)} cached)")
        return semantic_results

    except Exception as e:
        logger.error(f"❌ LLM enhancement failed: {e}")
        for result in semantic_results:
            result["has_llm_analysis"] = False
        return semantic_results
