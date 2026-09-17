"""Worker process that consumes the Redis match-job queue.

Run one (or a few) of these in dedicated containers so the CPU-bound matching
never competes with the API for cores. Each loop:

  1. blocking-pop the next job id
  2. acquire the global concurrency slot (cap = MATCH_QUEUE_MAX_CONCURRENT_JOBS)
  3. run the unchanged matching pipeline (app.services.ai.match_runner.run_match)
  4. write progress + the final MatchResponse back into Redis
"""

from __future__ import annotations

import asyncio
import logging
import time

from app.core.config import settings
from app.core.logging_config import configure_logging
from app.services.ai.match_runner import run_match
from app.services.queue.match_queue import (
    claim_next,
    get_job,
    is_match_queue_enabled,
    release,
    release_slot,
    requeue_stale_jobs,
    set_failed,
    set_progress,
    set_result,
    try_acquire_slot,
    update_job,
)

configure_logging()
logger = logging.getLogger("match-worker")


async def _run_job(job_id: str) -> None:
    job = get_job(job_id)
    if not job:
        logger.warning(f"Job {job_id} vanished before it could run")
        return
    if job.get("status") in ("completed", "failed"):
        return

    params = job.get("params") or {}
    update_job(job_id, status="processing", started_at=time.time(),
               progress={"status": "processing", "progress_percent": 1})

    def _progress(p: dict) -> None:
        set_progress(job_id, p)

    try:
        resp = await asyncio.wait_for(
            run_match(
                jd_id=params.get("jd_id"),
                jd_text=params.get("jd_text"),
                cv_ids=params.get("cv_ids"),
                weights=params.get("weights"),
                progress_cb=_progress,
            ),
            timeout=settings.MATCHING_TIMEOUT_SECONDS,
        )
        set_result(job_id, resp.dict())
        logger.info(f"✅ Match job {job_id} completed ({len(resp.candidates)} candidates)")
    except asyncio.TimeoutError:
        set_failed(job_id, f"Matching exceeded {settings.MATCHING_TIMEOUT_SECONDS}s and was aborted")
        logger.error(f"⏱️  Match job {job_id} timed out")
    except Exception as e:  # noqa: BLE001
        set_failed(job_id, str(e))
        logger.exception(f"❌ Match job {job_id} failed: {e}")


async def main() -> None:
    if not is_match_queue_enabled():
        logger.info("⏸️ Match worker disabled (ENABLE_MATCH_QUEUE!=true or Redis down)")
        return

    # Warm the embedding model once so the first job isn't slow.
    try:
        from app.services.ai.embedding_service import get_embedding_service
        get_embedding_service()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Embedding warm-up skipped: {e}")

    requeue_stale_jobs()
    logger.info("🚀 Match worker started")

    poll = max(1, settings.MATCH_QUEUE_POLL_TIMEOUT)
    while True:
        try:
            job_id = await asyncio.to_thread(claim_next, poll)
        except Exception as e:  # noqa: BLE001
            if "timeout" in str(e).lower():
                continue
            logger.exception(f"claim_next error: {e}")
            await asyncio.sleep(1)
            continue

        if not job_id:
            continue

        # Wait for a global slot before doing any heavy work.
        while not try_acquire_slot():
            await asyncio.sleep(2)

        try:
            await _run_job(job_id)
        finally:
            release_slot()
            release(job_id)


if __name__ == "__main__":
    asyncio.run(main())
