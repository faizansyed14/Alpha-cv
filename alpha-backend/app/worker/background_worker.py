"""Combined background worker: email scheduler + public-CV queue consumer.

These used to be two separate containers. Both are low-frequency, non-CPU
tasks (the email scheduler just checks a clock every 30s; the public-CV
consumer just waits on a Redis queue) — neither is the kind of CPU-hungry
work that `match-worker` deliberately got its own container for. But each one
imports the full CV pipeline (parsing, LLM standardization, embeddings) the
moment it touches its first email or application, so under real traffic two
containers meant two independent copies of the sentence-transformer model in
RAM (several hundred MB each) for no isolation benefit. Running both as
concurrent asyncio tasks in one process removes that duplication and a whole
container's baseline overhead, while `match-worker` stays fully separate.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

from app.core.logging_config import configure_logging

configure_logging()
logger = logging.getLogger("background-worker")


def _enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes")


async def _run_email_scheduler() -> None:
    if not _enabled("ENABLE_EMAIL_SCHEDULER"):
        logger.info("⏸️ Email scheduler disabled (ENABLE_EMAIL_SCHEDULER!=true)")
        return
    from app.services.email.email_scheduler import get_email_scheduler

    logger.info("📧 Starting email scheduler task")
    await get_email_scheduler().start_scheduler()


async def _run_public_cv_consumer() -> None:
    from app.services.queue.public_cv_queue import (
        QUEUE_KEY,
        STATUS_NS,
        is_public_cv_queue_enabled,
        set_public_job_status,
    )

    if not is_public_cv_queue_enabled():
        logger.info("⏸️ Public CV queue disabled (ENABLE_PUBLIC_CV_QUEUE!=true)")
        return

    from app.utils.redis_cache import get_redis_cache

    cache = get_redis_cache()
    if not cache.is_connected:
        logger.error("Redis not connected; public CV consumer cannot run")
        return

    from app.services.careers_service import process_job_application_async

    qkey = f"cv_app:{STATUS_NS}:{QUEUE_KEY}"
    logger.info(f"📥 Starting public CV queue consumer task. Queue={qkey}")

    while True:
        try:
            item = await asyncio.to_thread(cache.redis_client.brpop, qkey, 1)
        except Exception as e:  # idle socket timeout while waiting; keep looping
            if "timeout" in e.__class__.__name__.lower() or "timeout" in str(e).lower():
                continue
            logger.exception(f"public CV consumer BRPOP error: {e}")
            await asyncio.sleep(1)
            continue
        if not item:
            continue

        _, payload = item
        application_data = None
        try:
            application_data = json.loads(payload)
            job_id = application_data.get("application_id") or "unknown"
            set_public_job_status(job_id, status="processing", started_at=time.time(), error=None)

            result = await process_job_application_async(application_data)
            if isinstance(result, dict) and result.get("success") is False:
                error = result.get("error") or result.get("message")
                set_public_job_status(job_id, status="failed", finished_at=time.time(), error=error)
                logger.error(f"❌ Public CV job failed (reported): {job_id}: {error}")
            else:
                set_public_job_status(job_id, status="completed", finished_at=time.time())
                logger.info(f"✅ Public CV job completed: {job_id}")
        except Exception as e:
            job_id = (application_data or {}).get("application_id", "unknown")
            set_public_job_status(job_id, status="failed", finished_at=time.time(), error=str(e))
            logger.error(f"❌ Public CV job failed: {job_id}: {e}")


async def main() -> None:
    from app.services.email.email_database_service import email_db_service  # noqa: F401 (ensures tables)

    logger.info("🚀 Background worker started (email scheduler + public CV consumer)")
    await asyncio.gather(
        _run_email_scheduler(),
        _run_public_cv_consumer(),
    )
    logger.info("🛑 Background worker: all tasks exited")


if __name__ == "__main__":
    asyncio.run(main())
