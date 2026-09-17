# Matching — scalability, bottlenecks & the sharding question

_Last updated: 2026-08-27_

This document explains how CV↔JD matching now scales, what the real
bottlenecks are, why **vector‑DB sharding is not needed**, and how to tune the
system for a **4 vCPU / 16 GB** host.

---

## 1. What changed

### 1.1 GPU code removed
The deployment was already CPU‑only; the GPU paths were dead weight and have
been deleted:

| Area | Before | After |
|------|--------|-------|
| `config.USE_GPU` | env flag, always `false` | removed; new `TORCH_NUM_THREADS` (default `1`) |
| `embedding_service` | `torch.cuda.is_available()` branch, `device` selection, `calculate_batch_cosine_similarity_gpu` alias | always CPU; `torch.set_num_threads(TORCH_NUM_THREADS)` at import |
| `performance_routes` | `nvidia-smi` subprocess, GPU temp warnings | `get_gpu_stats()` returns `[]`; endpoints kept for UI compatibility |

The **scoring algorithm is untouched** — same weights (`skills 0.50`,
`responsibilities 0.20`, `job_title 0.20`, `experience 0.10`), same Hungarian
assignment (`scipy.optimize.linear_sum_assignment`), same similarity thresholds,
same business‑rule bonuses/penalties, same top‑50 LLM enhancement.

### 1.2 Matching moved off the API process → Redis queue + dedicated worker

```
        POST /api/match                     match-worker container
   ┌───────────────────────┐            ┌──────────────────────────┐
   │ hash(jd, cv_ids, w)   │  LPUSH     │ BRPOP queue              │
   │ enqueue if new        │──────────▶ │ acquire global slot      │
   │ return is_queued=true │            │ run_match() (unchanged)  │
   │ (job_id, position)    │            │ write progress + result  │
   └───────────────────────┘   Redis    │ to Redis                 │
        ▲     re-POST / GET /api/match/jobs/{id}  └──────────────────────────┘
        └────────────────────────────────────────────┘
```

* **`app/services/queue/match_queue.py`** — Redis list queue, JSON status
  records, request‑hash de‑duplication, a global concurrency counter, stale‑job
  requeue.
* **`app/worker/match_worker.py`** — `python -m app.worker.match_worker`, one
  job at a time (see `MATCH_QUEUE_MAX_CONCURRENT_JOBS`), scoring parallelised
  across `MATCH_THREAD_POOL_WORKERS` threads.
* **`app/services/ai/match_runner.py`** — the exact pipeline that used to live
  inline in `special_routes.match_candidates` (resolve JD → gather candidates →
  score → sort → LLM top‑50 → persist), now callable from the worker.
* **`special_routes.py`** — `POST /api/match` only enqueues; a new
  `GET /api/match/jobs/{job_id}` exposes status/progress/result. If the queue is
  disabled or Redis is down it falls back to running inline (bounded by
  `MAX_CONCURRENT_MATCHES`).

**Frontend contract is unchanged.** The existing "re‑POST the same request to
poll" behaviour still works because identical requests re‑attach to the running
job and receive the finished `MatchResponse` once it completes. `careersStore`
and `appStore` were updated to also understand `status: "failed"` and the
`progress` object.

### 1.3 The 300‑CV hard cap is gone

* `MAX_CV_LIMIT` (300) deleted. `bulk_match`'s internal `max_bulk_size = 200`
  removed.
* Replaced by `MATCH_MAX_CVS` (default **5000**, `0` = unlimited) — a pure
  "don't let one job run forever" ceiling, not a product limit.
* The worker **streams candidates in `MATCH_CHUNK_SIZE` chunks** and fetches
  their Qdrant payloads in `MATCH_QDRANT_BATCH_SIZE` batches, so peak memory is
  a function of the chunk size, **not** the total number of CVs. 5 000, 20 000,
  or more all work; they just take longer.

---

## 2. Bottleneck analysis

Measured/estimated on the target box (4 vCPU, `all-mpnet-base-v2`, 32 stored
vectors per doc).

| # | Bottleneck | Before | Fix in this change | Residual |
|---|-----------|--------|--------------------|----------|
| 1 | **Matching ran inside uvicorn workers** — CPU‑bound NumPy + SciPy for every CV plus a bulk LLM call, holding the HTTP request open for minutes and starving all other API traffic. | Fatal under concurrency | Moved to `match-worker`; API only enqueues. | Worker is now the throughput unit — scale with replicas. |
| 2 | **Per‑CV Qdrant round‑trips** — "match all" did `list_all_cvs()` (capped at 1 scroll page = 1000!) then one `get_structured_cv()` **per CV** (≈ 2 point reads each). | ~2·N requests | `list_all_cvs()` now paginates fully; `match_runner` uses `get_structured_cvs_batch()` in pages of `MATCH_QDRANT_BATCH_SIZE`. | N/256 batched reads. |
| 3 | **CPU thread oversubscription** — every container loads the embedding model; torch/BLAS each spawned `min(cores)` threads → N_containers × 4 threads thrashing 4 vCPUs. | Context‑switch storm | `TORCH_NUM_THREADS=1` everywhere; API dropped to 2 uvicorn workers; `MATCH_THREAD_POOL_WORKERS=4`. | Tune per host. |
| 4 | **`scipy.linear_sum_assignment` per CV** on ≤ 30×20 matrices | ~2–8 ms/CV, serial | Parallelised across the thread pool inside a job; unchanged math. | ~N·5 ms / pool_workers of pure CPU. For 5 000 CVs ≈ a few minutes. |
| 5 | **LLM enhancement** — one bulk GPT‑4.1‑mini call for the top `min(50, N)`, cached per `(jd_id, cv_id)` for 30 days. | OK | unchanged | External latency (~10–60 s), fully cached on repeat. |
| 6 | **`gc.collect()` after every chunk** | minor | kept (cheap insurance in a long‑running worker) | negligible |
| 7 | **Result size in Redis** — a finished `MatchResponse` for thousands of candidates is multi‑MB JSON. | n/a | stored with TTL (`MATCH_JOB_TTL_SECONDS`); `REDIS_MAXMEMORY` raised to `2gb`. | Bump `REDIS_MAXMEMORY` if you routinely match 10k+ and keep many results. |
| 8 | **Embedding model resident in 4 containers** (~0.4–0.8 GB RSS each) | ~2–3 GB | accepted within the 16 GB budget | A shared embedding micro‑service would reclaim ~2 GB if ever needed. |

---

## 3. Do we need vector‑DB sharding? **No.**

### Why not

Matching **does not use Qdrant vector search (ANN) at all**. Each document's 32
vectors are stored **as a JSON payload** on a single point that carries a dummy
`[0]*768` vector (`store_embeddings_exact` → `payload["vector_structure"]`).
Matching does:

1. `retrieve(ids=[...])` — a **key/value lookup by point id**, and
2. cosine + Hungarian **in Python/NumPy** on the app side.

Sharding (`shard_number`) and replication distribute an **HNSW index and its
search load**. We don't run that search, so sharding would add cluster
complexity, cross‑shard fan‑out, and rebalancing cost for **zero** matching
speed‑up. The work that actually costs time (bottlenecks #1, #3, #4) is CPU on
the application side.

### What actually scales matching

| Lever | How |
|-------|-----|
| **More `match-worker` replicas** | `docker compose -f docker-compose.prod.yml up -d --scale match-worker=N`. Each pulls independent jobs. Raise `MATCH_QUEUE_MAX_CONCURRENT_JOBS` to let ≥ 2 run at once **only** once the host (or a bigger host) has spare cores. |
| **Batched Qdrant reads** | `MATCH_QDRANT_BATCH_SIZE` (done). |
| **Bounded CPU threads** | `TORCH_NUM_THREADS`, `MATCH_THREAD_POOL_WORKERS` (done). |
| **Result/score caches** | `match_by_ids` Redis cache (`MATCH_RESULT_CACHE_*`), per‑`(jd,cv)` LLM cache (30 d), and the new job‑level de‑dupe window (`MATCH_RESULT_CACHE_TTL_SECONDS`). |

### When Qdrant itself becomes the limit (capacity, not sharding)

Payload cost per document ≈ 32 × 768 × 4 B ≈ **98 KB** (plus JSON overhead), so:

| Documents | Rough Qdrant RAM for vectors‑in‑payload |
|-----------|----------------------------------------|
| 50 000 | ~5 GB |
| 250 000 | ~25 GB |
| 1 000 000 | ~100 GB |

Mitigations, **in order**, none of which is sharding:

1. **Store the 32 vectors as real named vectors with `on_disk: true`**
   (mmap) instead of a JSON payload → RAM holds only hot pages. This is the
   single biggest win and is a storage‑format migration, not a topology change.
2. **Vertical RAM** on the Qdrant container / move Qdrant to its own box.
3. **Replication** (`replication_factor: 2`) for HA once there's a second node —
   still not sharding.
4. Only at *millions* of docs **and** if you also start doing real ANN
   pre‑filtering: introduce `shard_number` + a Qdrant cluster.

For the current product (tens of thousands of CVs) none of this is required.

---

## 4. Tuning for a 4 vCPU / 16 GB host

### 4.1 Container budget (`docker-compose.prod.yml`, `deploy.resources.limits`)

| Service | mem limit | cpu limit | notes |
|---------|-----------|-----------|-------|
| backend (API) | 2560 M | 2.0 | `UVICORN_WORKERS=2` |
| **match-worker** | 3 G | 2.0 | 1 job at a time, 4 scoring threads |
| background-worker | 1536 M | 1.0 | email scheduler + public-CV consumer, merged (§4.3) |
| frontend | 768 M | 0.5 | |
| postgres | 2 G | 1.0 | `shared_buffers=512MB` |
| qdrant | 3 G | 1.5 | |
| redis | 2048 M | 0.75 | `--maxmemory 2gb` |
| nginx | 256 M | 0.25 | |
| **Σ limits** | **≈ 15 G** | (ceilings, burstable) | leaves headroom for the OS |

### 4.3 Why email-scheduler and public-cv-worker were merged

They used to be two separate containers. Both are low-frequency, non-CPU
tasks — the email scheduler checks a clock every 30s, the public-CV consumer
blocks on a Redis queue — unlike `match-worker`, which is genuinely CPU-bound
and stays deliberately isolated. But each one imports the full CV pipeline
(parsing, LLM standardization, embeddings) on first use, so under real
traffic two containers meant two independent copies of the sentence
transformer model in RAM (several hundred MB each) for zero isolation
benefit. They now run as two concurrent asyncio tasks in one
`background-worker` container (`app/worker/background_worker.py`), which
removes that duplication and a whole container's baseline overhead. 9
containers → 8, and the freed memory (~700 MB) went back into headroom rather
than being reassigned.

### 4.2 Key env vars (`.env`)

```dotenv
UVICORN_WORKERS=2
TORCH_NUM_THREADS=1

MATCH_MAX_CVS=5000                 # 0 = no ceiling
MATCHING_TIMEOUT_SECONDS=3600
MATCH_THREAD_POOL_WORKERS=4        # per-job scoring threads
MATCH_CHUNK_SIZE=50
MATCH_QDRANT_BATCH_SIZE=256

ENABLE_MATCH_QUEUE=true
MATCH_QUEUE_MAX_CONCURRENT_JOBS=1  # raise only with more cores / more workers
MATCH_JOB_STALE_SECONDS=5400
MATCH_JOB_TTL_SECONDS=86400
```

### 4.3 Expected behaviour

* 5 recruiters click "match" at once → 1 job runs, 4 queue; each recruiter sees a
  live position + progress bar; the API stays responsive throughout.
* A 5 000‑CV job: dominated by ~5 000 × few‑ms scoring / 4 threads + one bulk LLM
  call ⇒ **single‑digit minutes**, memory flat at ~chunk size.
* Reprocessing a CV then re‑matching the same set returns a fresh score after
  `MATCH_RESULT_CACHE_TTL_SECONDS` (default 30 min); within that window the
  cached job result is reused so the frontend's poll resolves instantly.

### 4.4 Scaling out later

1. `--scale match-worker=2` (needs a bigger host, e.g. 8 vCPU) **and**
   `MATCH_QUEUE_MAX_CONCURRENT_JOBS=2`.
2. Move Postgres → RDS and Qdrant → its own instance (already supported via env).
3. Switch Qdrant embeddings to `on_disk` named vectors (section 3) before doc
   count passes ~100 k.
