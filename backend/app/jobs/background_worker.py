"""Combined background worker: email scheduler + public-CV queue consumer.

These used to be two separate containers. Both are low-frequency, non-CPU
tasks (the email scheduler just checks a clock every 30s; the public-CV
consumer just waits on a Redis queue), neither is the kind of CPU-hungry
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

from app.config.logging import configure_logging

configure_logging()
logger = logging.getLogger("background-worker")


def _enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes")


async def _run_public_cv_consumer() -> None:
    """Consume the ingestion queue with several runners, so many CVs are processed at the same time."""
    from app.config.settings import settings
    from app.jobs.public_cv_queue import (
        QUEUE_KEY,
        STATUS_NS,
        is_public_cv_queue_enabled,
        set_public_job_status,
    )

    if not is_public_cv_queue_enabled():
        logger.info("Public CV queue disabled (ENABLE_PUBLIC_CV_QUEUE!=true)")
        return

    from app.providers.cache.redis import get_redis_cache

    cache = get_redis_cache()
    if not cache.is_connected:
        logger.error("Redis not connected; public CV consumer cannot run")
        return

    from app.ingestion.upload_job import KIND_CV_UPLOAD, process_cv_upload
    from app.services.careers_service import process_job_application_async

    qkey = f"cv_app:{STATUS_NS}:{QUEUE_KEY}"
    runners = max(1, settings.INGEST_WORKER_CONCURRENCY)
    logger.info(f"Starting ingest consumer: {runners} runner(s), queue={qkey}")
    from app.monitoring.recorder import get_recorder

    get_recorder().set_live(ingest_consumer=True, ingest_runners=runners)   # the API queues uploads only while this is set

    async def handle(job: dict) -> None:
        job_id = job.get("application_id") or "unknown"
        try:
            if job.get("kind") == KIND_CV_UPLOAD:
                await process_cv_upload(job)
                return
            set_public_job_status(job_id, status="processing", started_at=time.time(), error=None)
            result = await process_job_application_async(job)
            if isinstance(result, dict) and result.get("success") is False:
                error = result.get("error") or result.get("message")
                set_public_job_status(job_id, status="failed", finished_at=time.time(), error=error)
                logger.error(f"Public CV job failed (reported): {job_id}: {error}")
            else:
                set_public_job_status(job_id, status="completed", finished_at=time.time())
                logger.info(f"Public CV job completed: {job_id}")
        except Exception as e:  # noqa: BLE001
            set_public_job_status(job_id, status="failed", finished_at=time.time(), error=str(e))
            logger.error(f"Ingest job failed: {job_id}: {e}")

    async def runner() -> None:
        while True:
            try:
                item = await asyncio.to_thread(cache.redis_client.brpop, qkey, 1)
            except Exception as e:  # idle socket timeout while waiting; keep looping
                if "timeout" in e.__class__.__name__.lower() or "timeout" in str(e).lower():
                    continue
                logger.exception(f"ingest consumer BRPOP error: {e}")
                await asyncio.sleep(1)
                continue
            if not item:
                continue
            try:
                job = json.loads(item[1])
            except ValueError:
                logger.error("Dropping an unreadable ingest job")
                continue
            await handle(job)

    await asyncio.gather(*(runner() for _ in range(runners)))


async def _run_storage_watch() -> None:
    """Every DB_HEALTH_INTERVAL_SECONDS look at the database's size and dead rows and log what is wrong, so growth is seen early."""
    from app.config.settings import settings

    interval = settings.DB_HEALTH_INTERVAL_SECONDS
    if interval <= 0:
        return
    from app.db.database import engine
    from app.services.db_health import storage_report

    while True:
        try:
            report = await asyncio.to_thread(storage_report, engine)
            if report.get("supported"):
                logger.info("Database storage: %.1f GB, %s CVs, search index %s bytes per CV",
                            report["database_bytes"] / 1024 ** 3, report["candidates"], report["search_bytes_per_cv"])
            for warning in report.get("warnings", []):
                logger.warning("Database storage warning: %s", warning)
        except Exception:  # noqa: BLE001 - a monitoring failure never stops the worker
            logger.exception("The database storage check failed")
        await asyncio.sleep(interval)


async def main() -> None:
    from app.monitoring.recorder import get_recorder

    get_recorder().set_kind("background-worker")
    from app.db.startup_lock import schema_init_lock

    with schema_init_lock():   # the API migrates at the same moment; this is a no-op once it has
        from app.db.database import init_database

        init_database()

    logger.info("Background worker started (CV ingestion queue consumer)")
    await asyncio.gather(_run_public_cv_consumer(), _run_storage_watch())
    logger.info("Background worker: all tasks exited")


if __name__ == "__main__":
    asyncio.run(main())
