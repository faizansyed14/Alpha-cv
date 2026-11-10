"""Metrics recorder: every model call, API request and match job, shared by all processes through Redis.

Recording is fire-and-forget. Call sites append to an in-memory deque (microseconds, never raises, never blocks); a
single background thread per process drains it into Redis pipelines about once a second, so metrics add no latency to a
request and an unreachable Redis only costs the buffered records (bounded, oldest dropped and counted).

Redis layout (all keys expire, so monitoring can never fill the instance):
  mon:m:<minute>:<kind>|<role>|<model>   hash  calls, errors, total_ms, tokens_in, tokens_out, cost, b0..bN (latency buckets)
  mon:idx:<minute>                       set   the hashes above that exist for that minute
  mon:events                             list  recent notable events (model calls, failures, finished jobs), newest first
  mon:proc:<process id>                  hash  this process's heartbeat + live counters (expires in 20 s)

Any number of API and worker processes can write at once: counters are HINCRBY, never read-modify-write.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional, Tuple

from app.config.settings import settings


def redis_client():
    """The connected Redis client, or None when Redis is not reachable (the monitor then shows nothing instead of failing)."""
    from app.providers.cache.redis import get_redis_cache

    cache = get_redis_cache()
    return cache.redis_client if cache.is_connected else None

logger = logging.getLogger(__name__)

LATENCY_BUCKETS_MS = (10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 120000)
EVENTS_KEY = "mon:events"
METRIC_TTL_S = 8 * 24 * 3600
EVENT_CAP = 3000
LISTED_KINDS = ("llm", "job")   # every call of these is kept as an inspectable event; others only when they fail
HEARTBEAT_TTL_S = 20

# USD per 1M tokens (input, output). Estimates for the cost panel; unknown models cost 0 rather than guessing.
PRICES_PER_M: Dict[str, Tuple[float, float]] = {
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
}


def bucket_index(ms: float) -> int:
    for i, edge in enumerate(LATENCY_BUCKETS_MS):
        if ms <= edge:
            return i
    return len(LATENCY_BUCKETS_MS)


def percentile_from_buckets(buckets: List[int], q: float) -> Optional[float]:
    total = sum(buckets)
    if total == 0:
        return None
    target, running = q * total, 0
    for i, count in enumerate(buckets):
        running += count
        if running >= target:
            return float(LATENCY_BUCKETS_MS[i]) if i < len(LATENCY_BUCKETS_MS) else float(LATENCY_BUCKETS_MS[-1] * 2)
    return float(LATENCY_BUCKETS_MS[-1] * 2)


def estimate_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    base = next((m for m in sorted(PRICES_PER_M, key=len, reverse=True) if model.startswith(m)), None)
    if base is None:
        return 0.0
    p_in, p_out = PRICES_PER_M[base]
    return (tokens_in * p_in + tokens_out * p_out) / 1_000_000


@dataclass
class _Record:
    ts: float
    kind: str
    role: str
    model: str
    duration_ms: float
    status: str
    tokens_in: int = 0
    tokens_out: int = 0
    cost: float = 0.0
    detail: Dict[str, Any] = field(default_factory=dict)
    notable: bool = False


class Recorder:
    def __init__(self, max_buffer: int = 20_000) -> None:
        self._buf: Deque[_Record] = deque(maxlen=max_buffer)
        self.dropped = 0
        self.kind = "process"
        self.process_id = f"{socket.gethostname()}:{os.getpid()}"
        self.started_at = time.time()
        self.live: Dict[str, Any] = {}
        self._counters: Dict[str, int] = {}
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()

    # ---- call-site API (never raises) -----------------------------------------------------------------------------
    def record(self, kind: str, role: str, model: str, duration_ms: float, *, status: str = "ok",
               tokens_in: int = 0, tokens_out: int = 0, cost: Optional[float] = None,
               detail: Optional[Dict[str, Any]] = None, notable: bool = False) -> None:
        try:
            if not settings.MONITORING_ENABLED:
                return
            self._ensure_started()
            if len(self._buf) == self._buf.maxlen:
                self.dropped += 1
            if cost is None:
                cost = estimate_cost(model, tokens_in, tokens_out) if tokens_in or tokens_out else 0.0
            self._buf.append(_Record(time.time(), kind, role, model, float(duration_ms), status,
                                     int(tokens_in), int(tokens_out), float(cost), detail or {},
                                     notable or status != "ok" or kind in LISTED_KINDS))
            with self._lock:
                key = f"{kind}:{role}"
                self._counters[key] = self._counters.get(key, 0) + 1
        except Exception:  # noqa: BLE001 - monitoring must never break a request
            pass

    def set_kind(self, kind: str) -> None:
        """Name this process (api, match-worker, ...) and start its heartbeat right away, so it shows as online on the
        Monitor page before it has recorded anything."""
        self.kind = kind
        if settings.MONITORING_ENABLED:
            self._ensure_started()

    def set_live(self, **values: Any) -> None:
        self.live.update(values)

    # ---- background flush ------------------------------------------------------------------------------------------
    def _ensure_started(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            with self._lock:
                if self._thread is None or not self._thread.is_alive():
                    self._stop.clear()
                    self._thread = threading.Thread(target=self._loop, name="metrics-flush", daemon=True)
                    self._thread.start()

    def _loop(self) -> None:
        last_beat = 0.0
        while not self._stop.wait(1.0):
            self.flush()
            if time.time() - last_beat >= 2.0:
                self._heartbeat()
                last_beat = time.time()

    def _redis(self):
        return redis_client()

    def flush(self) -> None:
        if not self._buf:
            return
        records: List[_Record] = []
        while self._buf and len(records) < 5000:
            try:
                records.append(self._buf.popleft())
            except IndexError:
                break
        r = self._redis()
        if r is None:
            self.dropped += len(records)
            return
        try:
            pipe = r.pipeline(transaction=False)
            events = []
            for rec in records:
                minute = int(rec.ts // 60)
                member = f"{rec.kind}|{rec.role}|{rec.model}"
                key = f"mon:m:{minute}:{member}"
                pipe.hincrby(key, "calls", 1)
                if rec.status != "ok":
                    pipe.hincrby(key, "errors", 1)
                pipe.hincrbyfloat(key, "total_ms", rec.duration_ms)
                if rec.tokens_in:
                    pipe.hincrby(key, "tokens_in", rec.tokens_in)
                if rec.tokens_out:
                    pipe.hincrby(key, "tokens_out", rec.tokens_out)
                if rec.cost:
                    pipe.hincrbyfloat(key, "cost", rec.cost)
                pipe.hincrby(key, f"b{bucket_index(rec.duration_ms)}", 1)
                pipe.expire(key, METRIC_TTL_S)
                idx = f"mon:idx:{minute}"
                pipe.sadd(idx, member)
                pipe.expire(idx, METRIC_TTL_S)
                if rec.notable:
                    events.append(json.dumps({
                        "ts": round(rec.ts, 3), "kind": rec.kind, "role": rec.role, "model": rec.model,
                        "ms": round(rec.duration_ms, 1), "status": rec.status, "tokens_in": rec.tokens_in,
                        "tokens_out": rec.tokens_out, "cost": round(rec.cost, 6), "detail": rec.detail,
                        "proc": self.kind}))
            if events:
                pipe.lpush(EVENTS_KEY, *events)
                pipe.ltrim(EVENTS_KEY, 0, EVENT_CAP - 1)
            pipe.execute()
        except Exception:  # noqa: BLE001
            self.dropped += len(records)
            logger.debug("metrics flush failed", exc_info=True)

    def _heartbeat(self) -> None:
        r = self._redis()
        if r is None:
            return
        try:
            with self._lock:
                counters = dict(self._counters)
            stats = json.dumps({"counters": counters, "live": self.live, "dropped": self.dropped,
                                "buffered": len(self._buf)})
            key = f"mon:proc:{self.process_id}"
            r.hset(key, mapping={"kind": self.kind, "host": socket.gethostname(), "pid": os.getpid(),
                                 "started_at": self.started_at, "beat": time.time(), "stats": stats})
            r.expire(key, HEARTBEAT_TTL_S)
        except Exception:  # noqa: BLE001
            pass


_recorder = Recorder()


def get_recorder() -> Recorder:
    return _recorder


class timed:
    """Context manager: times a block and records it. `with timed("ocr", "page", "rapidocr") as t: ...`.
    Set ``t.tokens_in`` etc. inside the block, or ``t.fail()`` to mark a failure without raising."""

    def __init__(self, kind: str, role: str, model: str, *, notable: bool = False, **detail: Any) -> None:
        self.kind, self.role, self.model, self.notable, self.detail = kind, role, model, notable, detail
        self.tokens_in = self.tokens_out = 0
        self.status = "ok"

    def fail(self, status: str = "error") -> None:
        self.status = status

    def __enter__(self) -> "timed":
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        status = self.status if exc_type is None else "error"
        if exc is not None:
            self.detail.setdefault("error", str(exc)[:300])
        _recorder.record(self.kind, self.role, self.model, (time.perf_counter() - self._t0) * 1000, status=status,
                         tokens_in=self.tokens_in, tokens_out=self.tokens_out, detail=self.detail,
                         notable=self.notable)
