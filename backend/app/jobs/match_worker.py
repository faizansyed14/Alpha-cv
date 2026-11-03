"""Worker process that consumes the Redis match-job queue.

Run one (or a few) of these in dedicated containers so the CPU-bound matching
never competes with the API for cores. Each process runs
``MATCH_WORKER_CONCURRENCY`` independent runners, so several recruiters' jobs
progress at the same time. Every runner loops:

  1. take a global slot (a Redis lease; cap = MATCH_QUEUE_MAX_CONCURRENT_JOBS)
  2. blocking-pop the next job id
  3. run the matching pipeline (app.matching.runner.run_match) while a
     heartbeat keeps the lease alive
  4. write progress + the final MatchResponse back into Redis, release the slot

Failure handling: a crashed worker simply stops renewing its lease; a janitor
loop (running in every worker) re-queues its job, up to MATCH_JOB_MAX_ATTEMPTS.
On SIGTERM the worker stops taking jobs, lets running ones finish for
``MATCH_SHUTDOWN_GRACE_SECONDS``, then hands the rest back to the queue.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import signal
import socket
import time

from app.config.settings import settings
from app.config.logging import configure_logging
from app.matching.runner import run_match
from app.jobs import match_queue as mq
from app.monitoring.recorder import get_recorder

configure_logging()
logger = logging.getLogger("match-worker")

_JANITOR_INTERVAL_S = 30


async def _run_job(job_id: str) -> None:
    job = await asyncio.to_thread(mq.get_job, job_id)
    if not job:
        logger.warning(f"Job {job_id} vanished before it could run")
        return
    if job.get("status") in ("completed", "failed"):
        return

    params = job.get("params") or {}
    await asyncio.to_thread(
        mq.update_job, job_id, status="processing", started_at=time.time(),
        progress={"status": "processing", "progress_percent": 1})

    def _progress(p: dict) -> None:
        mq.set_progress(job_id, p)

    started = time.perf_counter()
    queued_at = float(job.get("queued_at") or 0)
    info = {"job_id": job_id, "attempt": int(job.get("attempts") or 1),
            "cvs": len(params.get("cv_ids") or []) or None,
            "queue_wait_s": round(time.time() - queued_at, 1) if queued_at else None}
    outcome = "error"

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
        await asyncio.to_thread(mq.set_result, job_id, resp.dict())
        info["candidates"] = len(resp.candidates)
        info["llm_analyzed"] = sum(1 for c in resp.candidates if getattr(c, "has_llm_analysis", False))
        outcome = "ok"
        logger.info(f"Match job {job_id} completed ({len(resp.candidates)} candidates)")
    except asyncio.TimeoutError:
        await asyncio.to_thread(
            mq.set_failed, job_id, f"Matching exceeded {settings.MATCHING_TIMEOUT_SECONDS}s and was aborted")
        info["error"] = "timeout"
        logger.error(f" Match job {job_id} timed out")
    except asyncio.CancelledError:
        raise  # shutdown: the caller hands the job back to the queue
    except Exception as e:  # noqa: BLE001
        await asyncio.to_thread(mq.set_failed, job_id, str(e))
        info["error"] = str(e)[:300]
        logger.exception(f"Match job {job_id} failed: {e}")
    finally:
        if outcome == "ok" or "error" in info:  # not on shutdown hand-back
            get_recorder().record("job", "match", "pipeline", (time.perf_counter() - started) * 1000,
                                  status=outcome, detail=info, notable=True)


async def _heartbeat(token: str) -> None:
    """Keep the slot lease alive for as long as the job runs."""
    interval = max(5.0, mq.lease_ttl() / 3)
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(mq.renew_slot, token)


class MatchWorker:
    def __init__(self) -> None:
        self.stop_event = asyncio.Event()
        self.host = f"{socket.gethostname()}:{os.getpid()}"
        self.poll = max(1, settings.MATCH_QUEUE_POLL_TIMEOUT)
        self.active: dict[str, asyncio.Task] = {}   # job_id -> task, for shutdown hand-back

    async def _runner(self, index: int) -> None:
        token = f"{self.host}:{index}"
        while not self.stop_event.is_set():
            # Take the slot *before* popping so queued jobs stay visible (and poppable by other replicas) while
            # every slot is busy, and queue positions stay accurate.
            if not await asyncio.to_thread(mq.try_acquire_slot, token):
                await self._sleep(2)
                continue
            job_id = None
            try:
                # Runner 0 takes the next job at once. Extra runners only take a job that has already waited a few
                # seconds, i.e. one no idle worker process took: jobs spread over processes instead of sharing one CPU.
                wait = 0 if index == 0 else settings.MATCH_EXTRA_RUNNER_CLAIM_DELAY_SECONDS
                job_id = await asyncio.to_thread(mq.claim_next, self.poll, token, wait)
                if job_id:
                    await self._execute(job_id, token)
                elif wait:
                    await self._sleep(1)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                logger.exception(f"runner {index} error: {e}")
                await self._sleep(1)
            finally:
                await asyncio.to_thread(mq.release_slot, token)
                if job_id and job_id not in self.active:
                    await asyncio.to_thread(mq.release, job_id)

    async def _execute(self, job_id: str, token: str) -> None:
        await asyncio.to_thread(mq.renew_slot, token)  # make sure the lease exists before the janitor's next pass
        beat = asyncio.create_task(_heartbeat(token))
        task = asyncio.current_task()
        self.active[job_id] = task
        try:
            await _run_job(job_id)
            self.active.pop(job_id, None)  # finished normally: the finally above releases its processing record
        finally:
            beat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await beat

    async def _janitor(self) -> None:
        while not self.stop_event.is_set():
            await asyncio.to_thread(mq.requeue_stale_jobs)
            await self._sleep(_JANITOR_INTERVAL_S)

    async def _sleep(self, seconds: float) -> None:
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(self.stop_event.wait(), timeout=seconds)

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            with contextlib.suppress(NotImplementedError):  # Windows
                loop.add_signal_handler(sig, self.stop_event.set)

        count = max(1, settings.MATCH_WORKER_CONCURRENCY)
        cap = settings.MATCH_QUEUE_MAX_CONCURRENT_JOBS
        logger.info(f"Match worker started ({count} runner(s), {'no global cap' if cap <= 0 else f'global cap {cap}'})")
        runners = [asyncio.create_task(self._runner(i), name=f"runner-{i}") for i in range(count)]
        janitor = asyncio.create_task(self._janitor(), name="janitor")

        await self.stop_event.wait()
        logger.info("Shutdown requested: finishing running jobs")
        grace = settings.MATCH_SHUTDOWN_GRACE_SECONDS
        _, pending = await asyncio.wait(runners, timeout=grace)
        for task in pending:
            task.cancel()
        # Anything still running after the grace period goes back to the front of the queue (attempt already counted).
        for job_id in list(self.active):
            await asyncio.to_thread(mq.requeue_job, job_id, "worker shutting down")
        await asyncio.gather(*pending, return_exceptions=True)
        janitor.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await janitor
        logger.info("Match worker stopped")


async def main() -> None:
    get_recorder().set_kind("match-worker")
    if not mq.is_match_queue_enabled():
        logger.info("Match worker disabled (ENABLE_MATCH_QUEUE!=true or Redis down)")
        return

    # Warm the embedding client once so the first job doesn't pay for it.
    try:
        from app.providers.embeddings.service import get_embedding_service
        get_embedding_service()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Embedding warm-up skipped: {e}")

    await asyncio.to_thread(mq.requeue_stale_jobs)
    await MatchWorker().run()


if __name__ == "__main__":
    asyncio.run(main())
