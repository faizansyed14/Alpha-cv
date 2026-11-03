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
* Running jobs hold a *lease* (a sorted-set entry whose score is its expiry,
  renewed by the worker's heartbeat). The set's size is the global concurrency
  gate, and an expired lease is how a crashed worker's job is detected, so a
  killed container can neither leak a slot nor strand a job.
* One queue, one flow, whatever the size of the match: any number of users can submit at once, the queue absorbs
  the burst, and the runners (a fixed number per worker, so CPU is bounded) drain it in order.
* Optional admission control (all disabled by default): a per-user cap and a depth cap (``QueueFull`` -> HTTP 429).
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from app.config.settings import settings
from app.providers.cache.redis import get_redis_cache

logger = logging.getLogger(__name__)

# Raw redis keys (kept consistent with the public_cv_queue convention).
QUEUE_KEY = "cv_app:match_jobs:queue"
PROCESSING_KEY = "cv_app:match_jobs:processing"
LEASES_KEY = "cv_app:match_jobs:leases"        # zset: slot token -> lease expiry (epoch seconds)
USER_JOBS_PREFIX = "cv_app:match_jobs:user:"   # set of a user's active job ids
STATUS_NS = "match_jobs"            # redis_cache namespace for status records
DEDUPE_NS = "match_jobs_dedupe"     # request-hash -> job_id


class QueueFull(RuntimeError):
    """The queue refused a new job (per-user or global admission limit)."""

    def __init__(self, message: str, retry_after: int = 30):
        super().__init__(message)
        self.retry_after = retry_after


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


def _save_job(job: Dict[str, Any], ttl_seconds: Optional[int] = None) -> None:
    get_redis_cache().set(
        job["job_id"], job, ttl_seconds=ttl_seconds or settings.MATCH_JOB_TTL_SECONDS, namespace=STATUS_NS
    )


def update_job(job_id: str, _ttl: Optional[int] = None, **updates: Any) -> Optional[Dict[str, Any]]:
    job = get_job(job_id) or {"job_id": job_id}
    job.update(updates)
    job["updated_at"] = _now()
    _save_job(job, _ttl)
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
    # A finished result can be large (every candidate's scores), so it expires sooner than the job's status record.
    update_job(job_id, settings.MATCH_RESULT_TTL_SECONDS, status="completed", result=result, finished_at=_now(),
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
            logger.info(f"↩ Re-attaching to in-flight match job {existing['job_id']}")
            return existing
        # Reuse a completed result only briefly, long enough for the frontend's
        # re-POST polling to pick it up, short enough that a CV/JD reprocess is
        # reflected on the next manual match. After that a fresh job runs.
        if existing.get("status") == "completed":
            age = _now() - float(existing.get("finished_at") or 0)
            if age <= max(120, settings.MATCH_RESULT_CACHE_TTL_SECONDS):
                logger.info(f" Returning recent completed match job {existing['job_id']} ({age:.0f}s old)")
                return existing
        return None

    # Fast path: an identical request is already in flight / recently done.
    existing_id = cache.get(rhash, namespace=DEDUPE_NS)
    if existing_id:
        hit = _usable(get_job(existing_id))
        if hit:
            return hit

    _admit(r, requested_by)

    job_id = uuid.uuid4().hex
    # Written with the raw client (for NX) but JSON-encoded so it round-trips
    # cleanly through cache.get()'s json.loads(), otherwise every later read
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
        # The slot holder is stale/expired, take it over.
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
    if requested_by:
        user_key = USER_JOBS_PREFIX + requested_by
        r.sadd(user_key, job_id)
        r.expire(user_key, settings.MATCH_JOB_TTL_SECONDS)
    # de-dupe pointer (dedupe_key) was already claimed atomically above
    r.lpush(QUEUE_KEY, json.dumps({"job_id": job_id}))

    logger.info(f"Match job queued: {job_id} (queue depth ~{queue_depth()})")
    return job


def _admit(r: Any, requested_by: str) -> None:
    """Refuse the job when the queue is saturated or this user already has too many active jobs."""
    max_depth = settings.MATCH_QUEUE_MAX_DEPTH
    if max_depth and queue_depth() >= max_depth:
        raise QueueFull("The matching queue is full. Please try again in a few minutes.")
    per_user = settings.MATCH_QUEUE_MAX_JOBS_PER_USER
    if not (per_user and requested_by):
        return
    user_key = USER_JOBS_PREFIX + requested_by
    active = 0
    for jid in r.smembers(user_key) or []:
        jid = jid.decode() if isinstance(jid, bytes) else jid
        job = get_job(jid)
        if job and job.get("status") in ("queued", "processing"):
            active += 1
        else:
            r.srem(user_key, jid)  # finished or expired: prune
    if active >= per_user:
        raise QueueFull(
            f"You already have {active} matching jobs in progress. Wait for one to finish before starting another.")


def queue_depth() -> int:
    try:
        return int(get_redis_cache().redis_client.llen(QUEUE_KEY))
    except Exception:
        return 0


def queue_position(job_id: str) -> Optional[int]:
    """1-based position of ``job_id`` in the pending queue (None if not waiting)."""
    try:
        # LPUSH adds at the head and BRPOP takes from the tail, so the last item runs next.
        ordered = list(reversed(get_redis_cache().redis_client.lrange(QUEUE_KEY, 0, -1)))
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
# Atomically: drop expired leases, then take a slot only if fewer than `cap` remain. One round-trip, no race between
# replicas (the old INCR/DECR counter leaked a slot whenever a worker was killed between the two).
_ACQUIRE_LUA = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
  return 1
end
return 0
"""


def lease_ttl() -> int:
    return max(30, settings.MATCH_LEASE_SECONDS)


def try_acquire_slot(token: str) -> bool:
    """Take one of the MATCH_QUEUE_MAX_CONCURRENT_JOBS global slots, identified by ``token``."""
    # 0 = no global cap: the runners themselves (MATCH_WORKER_CONCURRENCY x replicas) bound the concurrency.
    cap = settings.MATCH_QUEUE_MAX_CONCURRENT_JOBS if settings.MATCH_QUEUE_MAX_CONCURRENT_JOBS > 0 else 1_000_000
    now = _now()
    try:
        return bool(get_redis_cache().redis_client.eval(
            _ACQUIRE_LUA, 1, LEASES_KEY, now, cap, now + lease_ttl(), token))
    except Exception:
        logger.warning("slot acquire failed; allowing the job (fail open)", exc_info=True)
        return True  # better to run than to wedge the queue


def renew_slot(token: str) -> None:
    """Heartbeat: push the lease expiry forward while the job is still running.

    Re-creates the lease if it has gone (Redis restarted without persistence, the key was deleted): this runner IS
    running the job, and a missing lease would make every worker's janitor re-queue it and run it a second time.
    """
    try:
        get_redis_cache().redis_client.zadd(LEASES_KEY, {token: _now() + lease_ttl()})
    except Exception:
        logger.debug("slot renew failed", exc_info=True)


def release_slot(token: str) -> None:
    try:
        get_redis_cache().redis_client.zrem(LEASES_KEY, token)
    except Exception:
        pass


def _next_job_age() -> Optional[float]:
    """Seconds the job at the head of the queue has been waiting (None if the queue is empty)."""
    raw = get_redis_cache().redis_client.lindex(QUEUE_KEY, -1)
    if not raw:
        return None
    try:
        job = get_job(json.loads(raw).get("job_id")) or {}
        return _now() - float(job.get("queued_at") or 0)
    except Exception:
        return float("inf")  # unreadable record: let someone take it rather than leave it stuck


def claim_next(timeout: int, token: str = "", min_wait_seconds: float = 0) -> Optional[str]:
    """Pop the next job id, recording who runs it (``token`` = the slot it holds).

    ``min_wait_seconds`` > 0 is for a worker's *extra* runners (one already busy in the same process): they only take
    a job that has waited that long, i.e. one no idle worker picked up. Without it, a worker could take two jobs that
    then share its CPU while another worker sat idle (measured: 2 of 3 users' jobs on one process).

    ``timeout`` is clamped below the Redis client socket timeout so an idle
    blocking pop returns cleanly instead of raising.
    """
    cache = get_redis_cache()
    safe_timeout = max(1, min(int(timeout), max(1, settings.REDIS_SOCKET_TIMEOUT - 1)))
    try:
        if min_wait_seconds > 0:
            age = _next_job_age()
            if age is None or age < min_wait_seconds:
                return None
            raw = cache.redis_client.rpop(QUEUE_KEY)
            item = (QUEUE_KEY, raw) if raw else None
        else:
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
    cache.redis_client.hset(PROCESSING_KEY, job_id, json.dumps({"t": _now(), "slot": token}))
    job = get_job(job_id)
    if job is not None:
        update_job(job_id, attempts=int(job.get("attempts") or 0) + 1)
    return job_id


def release(job_id: str) -> None:
    try:
        get_redis_cache().redis_client.hdel(PROCESSING_KEY, job_id)
    except Exception:
        pass


def requeue_job(job_id: str, reason: str) -> None:
    """Put a job back at the *front* of the line (it already waited its turn), or fail it after too many tries."""
    release(job_id)
    job = get_job(job_id)
    if not job or job.get("status") in ("completed", "failed"):
        return
    if int(job.get("attempts") or 0) >= settings.MATCH_JOB_MAX_ATTEMPTS:
        set_failed(job_id, f"Matching was interrupted {job.get('attempts')} times ({reason}); giving up.")
        return
    update_job(job_id, status="queued", progress={"status": "queued", "progress_percent": 0})
    # RPUSH puts it at the tail of the list, which is the end BRPOP pops from, so it runs next.
    get_redis_cache().redis_client.rpush(QUEUE_KEY, json.dumps({"job_id": job_id}))


def requeue_stale_jobs() -> int:
    """Janitor: re-queue jobs whose worker died. Safe to run from every worker, repeatedly.

    A processing job is alive while its slot lease is unexpired. Entries without a slot (older format) fall back to the
    coarse MATCH_JOB_STALE_SECONDS age check.
    """
    r = get_redis_cache().redis_client
    n = 0
    try:
        now = _now()
        r.zremrangebyscore(LEASES_KEY, "-inf", now)
        for job_id, raw in (r.hgetall(PROCESSING_KEY) or {}).items():
            job_id = job_id.decode() if isinstance(job_id, bytes) else job_id
            try:
                meta = json.loads(raw)
                started, slot = float(meta["t"]), meta.get("slot") or ""
            except Exception:  # legacy entry: bare timestamp
                try:
                    started, slot = float(raw), ""
                except Exception:
                    started, slot = 0.0, ""
            if slot:
                if r.zscore(LEASES_KEY, slot) is not None or now - started < 15:
                    continue  # lease still valid (or too fresh to judge)
            elif now - started < settings.MATCH_JOB_STALE_SECONDS:
                continue
            requeue_job(job_id, "worker stopped responding")
            n += 1
    except Exception as e:  # noqa: BLE001
        logger.warning(f"requeue_stale_jobs skipped: {e}")
    if n:
        logger.info(f" Re-queued {n} stale match job(s)")
    return n
