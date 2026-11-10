"""Monitor page (administrators): model calls by role with latency / tokens / cost, API and match-job health, the match queue,
processes, Redis and system health, and alerts. Everything is read from the Redis rollups written by every API and worker
process (app/monitoring), so it covers the whole deployment, not just the process answering the request."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

import psutil
from fastapi import APIRouter, Depends

from app.api.deps import require_admin
from app.config.settings import settings
from app.jobs import match_queue as mq
from app.models.user import User
from app.monitoring import reader

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/monitor", tags=["monitor"])

MODEL_KINDS = ("llm", "embedder", "ocr")


def _minutes_today() -> int:
    now = datetime.now(timezone.utc)
    return max(1, now.hour * 60 + now.minute + 1)


def _queue_snapshot() -> Dict[str, Any]:
    from app.providers.cache.redis import get_redis_cache

    cache = get_redis_cache()
    if not cache.is_connected:
        return {"available": False}
    r = cache.redis_client
    now = time.time()
    r.zremrangebyscore(mq.LEASES_KEY, "-inf", now)
    return {
        "available": True,
        "waiting": int(r.llen(mq.QUEUE_KEY)),
        "running": int(r.zcard(mq.LEASES_KEY)),
        "processing": int(r.hlen(mq.PROCESSING_KEY)),
        "limits": {
            "worker_concurrency": settings.MATCH_WORKER_CONCURRENCY, "global_cap": settings.MATCH_QUEUE_MAX_CONCURRENT_JOBS,
        },
    }


def _redis_health() -> Dict[str, Any]:
    from app.providers.cache.redis import get_redis_cache

    cache = get_redis_cache()
    if not cache.is_connected:
        return {"available": False}
    info = cache.redis_client.info()
    hits, misses = int(info.get("keyspace_hits", 0)), int(info.get("keyspace_misses", 0))
    used, limit = int(info.get("used_memory", 0)), int(info.get("maxmemory", 0))
    return {"available": True, "used_mb": round(used / 1e6, 1), "max_mb": round(limit / 1e6, 1) if limit else None,
            "hit_ratio": round(hits / (hits + misses), 4) if hits + misses else None,
            "evicted_keys": int(info.get("evicted_keys", 0)), "clients": int(info.get("connected_clients", 0)),
            "ops_per_s": int(info.get("instantaneous_ops_per_sec", 0))}


def _system() -> Dict[str, Any]:
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    load = psutil.getloadavg() if hasattr(psutil, "getloadavg") else (0, 0, 0)
    return {"cpu_percent": psutil.cpu_percent(interval=None), "cpus": psutil.cpu_count(),
            "load_1m": round(load[0], 2), "memory_percent": vm.percent,
            "memory_used_gb": round(vm.used / 1e9, 2), "memory_total_gb": round(vm.total / 1e9, 2),
            "disk_percent": disk.percent}


def _library() -> Dict[str, Any]:
    try:
        from app.store import get_store

        return get_store().library_counts()
    except Exception:  # noqa: BLE001
        return {"cvs": None, "jds": None}


def _alerts(models: List[dict], jobs: Dict[str, Any], queue: Dict[str, Any], procs: List[dict],
            redis_h: Dict[str, Any], cost_today: float, sysinfo: Dict[str, Any]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []

    def add(level: str, title: str, detail: str) -> None:
        out.append({"level": level, "title": title, "detail": detail})

    llm = [m for m in models if m["kind"] == "llm"]
    calls, errors = sum(m["calls"] for m in llm), sum(m["errors"] for m in llm)
    if calls >= 5 and errors / calls > 0.1:
        add("danger", "LLM calls are failing", f"{errors} of {calls} calls failed in this window")
    if jobs["calls"] and jobs["errors"] / jobs["calls"] > 0.1:
        add("danger", "Match jobs are failing", f"{jobs['errors']} of {jobs['calls']} jobs failed")
    if queue.get("available") is False:
        add("danger", "Queue unavailable", "Redis is unreachable; matching requests are answered with 503")
    else:
        waiting = queue.get("waiting", 0)
        if waiting and not any(p["kind"] == "match-worker" and p["online"] for p in procs):
            add("danger", "No match worker online", f"{waiting} match job(s) are waiting and nothing is processing them")
        elif waiting > 25:
            add("warning", "Matching backlog", f"{waiting} jobs waiting; consider more match-worker replicas")
    for p in procs:
        if not p["online"]:
            add("warning", f"{p['kind']} offline", f"{p['host']} pid {p['pid']} stopped sending heartbeats")
    if redis_h.get("evicted_keys"):
        add("warning", "Redis is evicting keys", f"{redis_h['evicted_keys']} evicted; raise REDIS_MAXMEMORY")
    budget = float(getattr(settings, "LLM_DAILY_BUDGET_USD", 0) or 0)
    if budget and cost_today > budget * 0.9:
        add("warning", "LLM daily budget nearly used", f"${cost_today:.2f} of ${budget:.2f}")
    if sysinfo["memory_percent"] > 90:
        add("danger", "Host memory above 90%", f"{sysinfo['memory_percent']}% in use")
    return out


def _build_summary(minutes: int) -> Dict[str, Any]:
    models = reader.grouped(minutes, MODEL_KINDS)
    api_rows = reader.grouped(minutes, ("api",))
    api = reader.totals(minutes, "api")
    jobs = reader.totals(minutes, "job")
    cost_today = sum(m["cost_usd"] for m in reader.grouped(_minutes_today(), ("llm",)))
    queue = _queue_snapshot()
    procs = reader.processes()
    redis_h = _redis_health()
    sysinfo = _system()
    llm = [m for m in models if m["kind"] == "llm"]
    return {
        "window_minutes": minutes,
        "generated_at": time.time(),
        "api": {**api, "routes": api_rows[:12]},
        "models": models,
        "llm": {"calls": sum(m["calls"] for m in llm), "errors": sum(m["errors"] for m in llm),
                "tokens_in": sum(m["tokens_in"] for m in llm), "tokens_out": sum(m["tokens_out"] for m in llm),
                "cost_usd": round(sum(m["cost_usd"] for m in llm), 4), "cost_today_usd": round(cost_today, 4),
                "daily_budget_usd": float(getattr(settings, "LLM_DAILY_BUDGET_USD", 0) or 0) or None},
        "jobs": jobs,
        "queue": queue,
        "processes": procs,
        "redis": redis_h,
        "system": sysinfo,
        "library": _library(),
        "alerts": _alerts(models, jobs, queue, procs, redis_h, cost_today, sysinfo),
    }


@router.get("/summary")
async def summary(minutes: int = 60, _: User = Depends(require_admin)) -> Dict[str, Any]:
    minutes = max(5, min(minutes, 60 * 24 * 7))
    return await asyncio.to_thread(_build_summary, minutes)


@router.get("/timeseries")
async def timeseries(minutes: int = 60, _: User = Depends(require_admin)) -> Dict[str, Any]:
    minutes = max(5, min(minutes, 60 * 24 * 7))

    def build() -> Dict[str, Any]:
        return {"window_minutes": minutes, **{k: reader.timeseries(minutes, k) for k in ("llm", "api", "job", "embedder", "ocr")}}

    return await asyncio.to_thread(build)


@router.get("/events")
async def events(kind: str = "", failures: bool = False, limit: int = 50, _: User = Depends(require_admin)) -> Dict[str, Any]:
    kinds = tuple(k for k in kind.split(",") if k) or None
    return {"events": await asyncio.to_thread(reader.events, kinds, failures, max(1, min(limit, 200)))}
