"""Redis-backed queue for CV↔JD matching jobs.

Why this exists
---------------
Matching is CPU-bound (NumPy cosine + SciPy Hungarian over every candidate, plus
a bulk LLM call). Running it inside the API process makes the whole API
unresponsive while a match is in flight. This queue hands the work to the
dedicated ``match-worker`` container instead, so the API only ever enqueues a
job and reports progress.

Design (kept deliberately small for a 4 vCPU / 16 GB box)
--------------------------------------------------------
* One Redis list is the queue (``LPUSH`` / ``BRPOP``).
* Each job has a status record (JSON) in Redis with progress + result.
* Jobs are de-duplicated by a hash of ``(jd, cv_ids, weights)`` so the frontend's
  "re-POST to poll" pattern re-attaches to the running job instead of starting a
  second one.
* A global counter caps how many jobs run at once across every worker replica.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.utils.redis_cache import get_redis_cache

logger = logging.getLogger(__name__)

# Raw redis keys (kept consistent with the public_cv_queue convention).
QUEUE_KEY = "cv_app:match_jobs:queue"
PROCESSING_KEY = "cv_app:match_jobs:processing"
RUNNING_COUNTER_KEY = "cv_app:match_jobs:running"
STATUS_NS = "match_jobs"            # redis_cache namespace for status records
DEDUPE_NS = "match_jobs_dedupe"     # request-hash -> job_id


def is_match_queue_enabled() -> bool:
    if not settings.ENABLE_MATCH_QUEUE:
        return False
    try:
        return bool(get_redis_cache().is_connected)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Request identity
# ---------------------------------------------------------------------------
def request_hash(jd_id: Optional[str], jd_text: Optional[str],
                 cv_ids: Optional[List[str]], weights: Optional[Dict[str, float]]) -> str:
    payload = json.dumps({
        "jd_id": jd_id or "",
        "jd_text": (jd_text or "").strip(),
        "cv_ids": sorted(cv_ids) if cv_ids else None,
        "weights": {k: round(float(v), 6) for k, v in sorted((weights or {}).items())},
    }, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Status records
# ---------------------------------------------------------------------------
def _now() -> float:
    return time.time()


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    return get_redis_cache().get(job_id, namespace=STATUS_NS)


def _save_job(job: Dict[str, Any]) -> None:
    get_redis_cache().set(
        job["job_id"], job, ttl_seconds=settings.MATCH_JOB_TTL_SECONDS, namespace=STATUS_NS
    )


def update_job(job_id: str, **updates: Any) -> Optional[Dict[str, Any]]:
    job = get_job(job_id) or {"job_id": job_id}
    job.update(updates)
    job["updated_at"] = _now()
    _save_job(job)
    return job


def set_progress(job_id: str, progress: Dict[str, Any]) -> None:
    job = get_job(job_id)
    if not job:
        return
    job["progress"] = progress
    job["updated_at"] = _now()
    if progress.get("status"):
        # keep a coarse status in sync but never override a terminal state
        if job.get("status") not in ("completed", "failed"):
            job["status"] = "processing"
    _save_job(job)


def set_result(job_id: str, result: Dict[str, Any]) -> None:
    update_job(job_id, status="completed", result=result, finished_at=_now(),
               progress={"status": "completed", "progress_percent": 100})


def set_failed(job_id: str, error: str) -> None:
    update_job(job_id, status="failed", error=error, finished_at=_now(),
               progress={"status": "failed", "progress_percent": 100})


# ---------------------------------------------------------------------------
# Enqueue / dequeue
# ---------------------------------------------------------------------------
def enqueue_match(jd_id: Optional[str], jd_text: Optional[str],
                  cv_ids: Optional[List[str]], weights: Optional[Dict[str, float]],
                  requested_by: str = "") -> Dict[str, Any]:
    """Enqueue a match job (or re-attach to an identical in-flight one).

    Returns the job status record.
    """
    cache = get_redis_cache()
    if not cache.is_connected:
        raise RuntimeError("Redis not connected; cannot enqueue match job")

    r = cache.redis_client
    rhash = request_hash(jd_id, jd_text, cv_ids, weights)
    dedupe_key = f"cv_app:{DEDUPE_NS}:{rhash}"

    def _usable(existing: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not existing:
            return None
        if existing.get("status") in ("queued", "processing"):
            logger.info(f"↩️  Re-attaching to in-flight match job {existing['job_id']}")
            return existing
        # Reuse a completed result only briefly — long enough for the frontend's
        # re-POST polling to pick it up, short enough that a CV/JD reprocess is
        # reflected on the next manual match. After that a fresh job runs.
        if existing.get("status") == "completed":
            age = _now() - float(existing.get("finished_at") or 0)
            if age <= max(120, settings.MATCH_RESULT_CACHE_TTL_SECONDS):
                logger.info(f"♻️  Returning recent completed match job {existing['job_id']} ({age:.0f}s old)")
                return existing
        return None

    # Fast path: an identical request is already in flight / recently done.
    existing_id = cache.get(rhash, namespace=DEDUPE_NS)
    if existing_id:
        hit = _usable(get_job(existing_id))
        if hit:
            return hit

    job_id = uuid.uuid4().hex
    # Written with the raw client (for NX) but JSON-encoded so it round-trips
    # cleanly through cache.get()'s json.loads() — otherwise every later read
    # logs a spurious "Deserialization failed" (it still falls back to the raw
    # string, so it wasn't a functional bug, just log noise).
    encoded_job_id = json.dumps(job_id)

    # Atomically claim the de-dupe slot so two users clicking "match" on the
    # SAME job in the same instant produce exactly one queued job, not two.
    try:
        claimed = bool(r.set(dedupe_key, encoded_job_id, nx=True, ex=settings.MATCH_JOB_TTL_SECONDS))
    except Exception:
        claimed = True  # fail open
    if not claimed:
        hit = _usable(get_job(cache.get(rhash, namespace=DEDUPE_NS)))
        if hit:
            return hit
        # The slot holder is stale/expired — take it over.
        try:
            r.set(dedupe_key, encoded_job_id, ex=settings.MATCH_JOB_TTL_SECONDS)
        except Exception:
            pass

    job = {
        "job_id": job_id,
        "request_hash": rhash,
        "status": "queued",
        "requested_by": requested_by,
        "params": {
            "jd_id": jd_id,
            "jd_text": jd_text,
            "cv_ids": cv_ids,
            "weights": weights,
        },
        "queued_at": _now(),
        "updated_at": _now(),
        "started_at": None,
        "finished_at": None,
        "result": None,
        "error": None,
        "progress": {"status": "queued", "progress_percent": 0},
    }
    _save_job(job)
    # de-dupe pointer (dedupe_key) was already claimed atomically above
    r.lpush(QUEUE_KEY, json.dumps({"job_id": job_id}))

    logger.info(f"📥 Match job queued: {job_id} (queue depth ~{queue_depth()})")
    return job


def queue_depth() -> int:
    try:
        return int(get_redis_cache().redis_client.llen(QUEUE_KEY))
    except Exception:
        return 0


def queue_position(job_id: str) -> Optional[int]:
    """1-based position of ``job_id`` in the pending queue (None if not waiting)."""
    try:
        cache = get_redis_cache()
        items = cache.redis_client.lrange(QUEUE_KEY, 0, -1)  # index 0 = most recently pushed
        # BRPOP pops from the tail, so the tail is next. Position from the tail:
        ordered = list(reversed(items))
        for idx, raw in enumerate(ordered, start=1):
            try:
                if json.loads(raw).get("job_id") == job_id:
                    return idx
            except Exception:
                continue
    except Exception:
        pass
    return None


def estimate_wait_seconds(position: int) -> int:
    # Coarse: assume ~90s of queue drain per job ahead (tunable, display-only).
    return max(0, position) * 90


# ---------------------------------------------------------------------------
# Worker-side helpers
# ---------------------------------------------------------------------------
def claim_next(timeout: int) -> Optional[str]:
    """Blocking pop of the next job id, moving it to the processing set.

    ``timeout`` is clamped below the Redis client socket timeout so an idle
    blocking pop returns cleanly instead of raising.
    """
    cache = get_redis_cache()
    safe_timeout = max(1, min(int(timeout), max(1, settings.REDIS_SOCKET_TIMEOUT - 1)))
    try:
        item = cache.redis_client.brpop(QUEUE_KEY, safe_timeout)
    except Exception as e:  # redis TimeoutError while idle, etc.
        if "timeout" in e.__class__.__name__.lower() or "timeout" in str(e).lower():
            return None
        raise
    if not item:
        return None
    _, raw = item
    try:
        job_id = json.loads(raw).get("job_id")
    except Exception:
        return None
    if not job_id:
        return None
    cache.redis_client.hset(PROCESSING_KEY, job_id, _now())
    return job_id


def release(job_id: str) -> None:
    try:
        get_redis_cache().redis_client.hdel(PROCESSING_KEY, job_id)
    except Exception:
        pass


def try_acquire_slot() -> bool:
    """Global concurrency gate across all worker replicas."""
    cap = max(1, settings.MATCH_QUEUE_MAX_CONCURRENT_JOBS)
    cache = get_redis_cache()
    try:
        val = cache.redis_client.incr(RUNNING_COUNTER_KEY)
        cache.redis_client.expire(RUNNING_COUNTER_KEY, settings.MATCHING_TIMEOUT_SECONDS + 300)
        if val > cap:
            cache.redis_client.decr(RUNNING_COUNTER_KEY)
            return False
        return True
    except Exception:
        return True  # fail open — better to run than to wedge the queue


def release_slot() -> None:
    try:
        cache = get_redis_cache()
        if int(cache.redis_client.get(RUNNING_COUNTER_KEY) or 0) > 0:
            cache.redis_client.decr(RUNNING_COUNTER_KEY)
    except Exception:
        pass


def requeue_stale_jobs() -> int:
    """On worker startup, re-queue jobs left 'processing' by a crashed worker."""
    cache = get_redis_cache()
    n = 0
    try:
        entries = cache.redis_client.hgetall(PROCESSING_KEY) or {}
        for job_id, started in entries.items():
            try:
                started_at = float(started)
            except Exception:
                started_at = 0
            if _now() - started_at < settings.MATCH_JOB_STALE_SECONDS:
                continue
            job = get_job(job_id)
            if job and job.get("status") in ("completed", "failed"):
                cache.redis_client.hdel(PROCESSING_KEY, job_id)
                continue
            cache.redis_client.hdel(PROCESSING_KEY, job_id)
            cache.redis_client.lpush(QUEUE_KEY, json.dumps({"job_id": job_id}))
            update_job(job_id, status="queued",
                       progress={"status": "queued", "progress_percent": 0})
            n += 1
    except Exception as e:  # noqa: BLE001
        logger.warning(f"requeue_stale_jobs skipped: {e}")
    if n:
        logger.info(f"♻️  Re-queued {n} stale match job(s)")
    return n
