"""Read side of the metrics: aggregates the per-minute Redis hashes written by recorder.py for the Monitor page."""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

from app.monitoring.recorder import EVENTS_KEY, LATENCY_BUCKETS_MS, percentile_from_buckets, redis_client as _redis

N_BUCKETS = len(LATENCY_BUCKETS_MS) + 1
MODEL_KINDS = ("llm", "embedder", "ocr")


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _minute_rows(minutes: int) -> Dict[int, Dict[str, Dict[str, float]]]:
    """{minute: {"kind|role|model": {field: value}}} for the last `minutes` minutes (including the current one)."""
    r = _redis()
    if r is None:
        return {}
    now_min = int(time.time() // 60)
    window = list(range(now_min - minutes + 1, now_min + 1))
    pipe = r.pipeline(transaction=False)
    for m in window:
        pipe.smembers(f"mon:idx:{m}")
    members = pipe.execute()
    pipe = r.pipeline(transaction=False)
    order = []
    for m, mem in zip(window, members):
        for member in mem or []:
            member = member.decode() if isinstance(member, bytes) else member
            pipe.hgetall(f"mon:m:{m}:{member}")
            order.append((m, member))
    out: Dict[int, Dict[str, Dict[str, float]]] = {}
    for (m, member), h in zip(order, pipe.execute() if order else []):
        row = {(k.decode() if isinstance(k, bytes) else k): _num(v) for k, v in (h or {}).items()}
        if row:
            out.setdefault(m, {})[member] = row
    return out


def _buckets(row: Dict[str, float]) -> List[int]:
    return [int(row.get(f"b{i}", 0)) for i in range(N_BUCKETS)]


def _merge(into: Dict[str, float], row: Dict[str, float]) -> None:
    for k, v in row.items():
        into[k] = into.get(k, 0.0) + v


def _shape(kind: str, role: str, model: str, agg: Dict[str, float]) -> Dict[str, Any]:
    calls = int(agg.get("calls", 0))
    buckets = _buckets(agg)
    return {
        "kind": kind, "role": role, "model": model, "calls": calls, "errors": int(agg.get("errors", 0)),
        "avg_ms": round(agg.get("total_ms", 0.0) / calls, 1) if calls else None,
        "p50_ms": percentile_from_buckets(buckets, 0.5), "p95_ms": percentile_from_buckets(buckets, 0.95),
        "tokens_in": int(agg.get("tokens_in", 0)), "tokens_out": int(agg.get("tokens_out", 0)),
        "cost_usd": round(agg.get("cost", 0.0), 6),
    }


def grouped(minutes: int, kinds: Optional[tuple] = None) -> List[Dict[str, Any]]:
    """One row per (kind, role, model) over the window, busiest first."""
    acc: Dict[str, Dict[str, float]] = {}
    for rows in _minute_rows(minutes).values():
        for member, row in rows.items():
            if kinds and member.split("|", 1)[0] not in kinds:
                continue
            _merge(acc.setdefault(member, {}), row)
    out = [_shape(*member.split("|", 2), agg) for member, agg in acc.items()]
    return sorted(out, key=lambda x: -x["calls"])


def totals(minutes: int, kind: str) -> Dict[str, Any]:
    acc: Dict[str, float] = {}
    for rows in _minute_rows(minutes).values():
        for member, row in rows.items():
            if member.startswith(kind + "|"):
                _merge(acc, row)
    return _shape(kind, "*", "*", acc)


def timeseries(minutes: int, kind: str, points: int = 60) -> List[Dict[str, Any]]:
    """Calls / errors / p95 / tokens / cost per period for one kind. The period widens so the chart has ~`points` points."""
    step = max(1, -(-minutes // points))
    data = _minute_rows(minutes)
    now_min = int(time.time() // 60)
    first = now_min - minutes + 1
    out = []
    for start in range(first, now_min + 1, step):
        acc: Dict[str, float] = {}
        for m in range(start, min(start + step, now_min + 1)):
            for member, row in data.get(m, {}).items():
                if member.startswith(kind + "|"):
                    _merge(acc, row)
        calls = int(acc.get("calls", 0))
        out.append({"t": start * 60, "calls": calls, "errors": int(acc.get("errors", 0)),
                    "p95_ms": percentile_from_buckets(_buckets(acc), 0.95) if calls else None,
                    "tokens": int(acc.get("tokens_in", 0) + acc.get("tokens_out", 0)),
                    "cost_usd": round(acc.get("cost", 0.0), 6)})
    return out


def processes() -> List[Dict[str, Any]]:
    r = _redis()
    if r is None:
        return []
    out = []
    for key in r.scan_iter(match="mon:proc:*", count=200):
        h = r.hgetall(key)
        h = {(k.decode() if isinstance(k, bytes) else k): (v.decode() if isinstance(v, bytes) else v) for k, v in h.items()}
        if not h:
            continue
        try:
            stats = json.loads(h.get("stats") or "{}")
        except ValueError:
            stats = {}
        age = time.time() - _num(h.get("beat"))
        out.append({"id": (key.decode() if isinstance(key, bytes) else key).split("mon:proc:", 1)[1],
                    "kind": h.get("kind"), "host": h.get("host"), "pid": int(_num(h.get("pid"))),
                    "uptime_s": round(time.time() - _num(h.get("started_at"))), "age_s": round(age, 1),
                    "online": age < 15, "stats": stats})
    return sorted(out, key=lambda p: (p["kind"] or "", p["host"] or "", p["pid"]))


def events(kinds: Optional[tuple] = None, failures_only: bool = False, limit: int = 50) -> List[Dict[str, Any]]:
    r = _redis()
    if r is None:
        return []
    out: List[Dict[str, Any]] = []
    for raw in r.lrange(EVENTS_KEY, 0, 1499):
        try:
            e = json.loads(raw)
        except ValueError:
            continue
        if kinds and e.get("kind") not in kinds:
            continue
        if failures_only and e.get("status") == "ok":
            continue
        out.append(e)
        if len(out) >= limit:
            break
    return out
