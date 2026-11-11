"""Match queue: slots/leases, admission control, janitor re-queue and retry limits (no real Redis needed)."""

import json
import time

import pytest

from app.config.settings import settings
from app.jobs import match_queue as mq


class FakeRedis:
    """The few Redis commands match_queue uses, backed by dicts."""

    def __init__(self):
        self.lists, self.hashes, self.zsets, self.sets, self.kv = {}, {}, {}, {}, {}

    # strings
    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.kv:
            return None
        self.kv[key] = value
        return True

    def expire(self, *_):
        return True

    # lists (index 0 = head; LPUSH adds at head, BRPOP/RPUSH use the tail)
    def lpush(self, key, v):
        self.lists.setdefault(key, []).insert(0, v)

    def rpush(self, key, v):
        self.lists.setdefault(key, []).append(v)

    def llen(self, key):
        return len(self.lists.get(key, []))

    def lrange(self, key, a, b):
        return list(self.lists.get(key, []))

    def lindex(self, key, i):
        items = self.lists.get(key, [])
        return items[i] if items and -len(items) <= i < len(items) else None

    def rpop(self, key):
        items = self.lists.get(key, [])
        return items.pop() if items else None

    def brpop(self, keys, timeout):
        for key in ([keys] if isinstance(keys, str) else keys):  # first non-empty list wins, like Redis
            items = self.lists.get(key, [])
            if items:
                return (key, items.pop())
        return None

    # hashes
    def hset(self, key, field, value):
        self.hashes.setdefault(key, {})[field] = value

    def hdel(self, key, field):
        self.hashes.get(key, {}).pop(field, None)

    def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    # sets
    def sadd(self, key, v):
        self.sets.setdefault(key, set()).add(v)

    def srem(self, key, v):
        self.sets.get(key, set()).discard(v)

    def smembers(self, key):
        return set(self.sets.get(key, set()))

    # sorted sets
    def zadd(self, key, mapping, xx=False):
        z = self.zsets.setdefault(key, {})
        for member, score in mapping.items():
            if xx and member not in z:
                continue
            z[member] = score

    def zrem(self, key, member):
        self.zsets.get(key, {}).pop(member, None)

    def zscore(self, key, member):
        return self.zsets.get(key, {}).get(member)

    def zremrangebyscore(self, key, lo, hi):
        z = self.zsets.get(key, {})
        for m in [m for m, sc in z.items() if sc <= float(hi)]:
            del z[m]

    def eval(self, _script, _n, key, now, cap, expiry, token):  # mirrors _ACQUIRE_LUA
        self.zremrangebyscore(key, "-inf", now)
        z = self.zsets.setdefault(key, {})
        if len(z) < int(cap):
            z[token] = expiry
            return 1
        return 0


class FakeCache:
    def __init__(self):
        self.redis_client = FakeRedis()
        self.is_connected = True
        self.store = {}

    def get(self, key, namespace=""):
        if (namespace, key) in self.store:
            return self.store[(namespace, key)]
        raw = self.redis_client.kv.get(f"cv_app:{namespace}:{key}")  # written with the raw client (SET NX)
        return json.loads(raw) if raw is not None else None

    def set(self, key, value, ttl_seconds=None, namespace=""):
        self.store[(namespace, key)] = json.loads(json.dumps(value))


@pytest.fixture
def cache(monkeypatch):
    c = FakeCache()
    monkeypatch.setattr(mq, "get_redis_cache", lambda: c)
    monkeypatch.setattr(settings, "MATCH_QUEUE_MAX_CONCURRENT_JOBS", 2)
    monkeypatch.setattr(settings, "MATCH_QUEUE_MAX_JOBS_PER_USER", 2)
    monkeypatch.setattr(settings, "MATCH_QUEUE_MAX_DEPTH", 10)
    monkeypatch.setattr(settings, "MATCH_JOB_MAX_ATTEMPTS", 2)
    return c


def _enqueue(user="alice", n=0):
    return mq.enqueue_match(jd_id=f"jd{n}", jd_text=None, cv_ids=None, weights=None, requested_by=user)


def test_global_slots_are_capped_and_released(cache):
    assert mq.try_acquire_slot("a") and mq.try_acquire_slot("b")
    assert not mq.try_acquire_slot("c")  # cap = 2
    mq.release_slot("a")
    assert mq.try_acquire_slot("c")


def test_expired_lease_frees_its_slot(cache):
    assert mq.try_acquire_slot("a") and mq.try_acquire_slot("b")
    cache.redis_client.zsets[mq.LEASES_KEY]["a"] = time.time() - 1  # worker "a" died
    assert mq.try_acquire_slot("c")


def test_per_user_limit_is_enforced_per_user(cache):
    _enqueue("alice", 1)
    _enqueue("alice", 2)
    with pytest.raises(mq.QueueFull):
        _enqueue("alice", 3)
    _enqueue("bob", 3)  # another recruiter is unaffected


def test_finished_jobs_stop_counting_against_the_user(cache):
    j1 = _enqueue("alice", 1)
    _enqueue("alice", 2)
    mq.set_result(j1["job_id"], {"candidates": []})
    _enqueue("alice", 3)  # would raise QueueFull if the finished job still counted


def test_identical_request_reattaches_instead_of_duplicating(cache):
    first = _enqueue("alice", 1)
    second = _enqueue("bob", 1)
    assert first["job_id"] == second["job_id"]
    assert mq.queue_depth() == 1


def test_global_depth_cap(cache, monkeypatch):
    monkeypatch.setattr(settings, "MATCH_QUEUE_MAX_DEPTH", 2)
    monkeypatch.setattr(settings, "MATCH_QUEUE_MAX_JOBS_PER_USER", 0)
    _enqueue("a", 1)
    _enqueue("b", 2)
    with pytest.raises(mq.QueueFull):
        _enqueue("c", 3)


def test_janitor_requeues_job_of_dead_worker_to_the_front(cache):
    _enqueue("alice", 1)
    _enqueue("alice", 2)
    assert mq.try_acquire_slot("w1")
    job_id = mq.claim_next(1, "w1")
    cache.redis_client.zsets[mq.LEASES_KEY].pop("w1")  # lease lapsed
    cache.redis_client.hashes[mq.PROCESSING_KEY][job_id] = json.dumps({"t": time.time() - 60, "slot": "w1"})

    assert mq.requeue_stale_jobs() == 1
    assert mq.get_job(job_id)["status"] == "queued"
    assert mq.claim_next(1, "w2") == job_id  # runs next, ahead of the job queued after it


def test_live_lease_is_not_stolen(cache):
    _enqueue("alice", 1)
    mq.try_acquire_slot("w1")
    job_id = mq.claim_next(1, "w1")
    cache.redis_client.hashes[mq.PROCESSING_KEY][job_id] = json.dumps({"t": time.time() - 600, "slot": "w1"})
    assert mq.requeue_stale_jobs() == 0


def test_job_that_keeps_crashing_is_failed_not_retried_forever(cache):
    _enqueue("alice", 1)
    for _ in range(settings.MATCH_JOB_MAX_ATTEMPTS):
        job_id = mq.claim_next(1, "w1")
        assert job_id
        mq.requeue_job(job_id, "crash")
    assert mq.get_job(job_id)["status"] == "failed"
    assert mq.queue_depth() == 0


def test_shipped_limits_are_a_few_matches_per_person_and_a_deep_queue_but_never_a_cap_on_workers(monkeypatch):
    c = FakeCache()
    monkeypatch.setattr(mq, "get_redis_cache", lambda: c)
    defaults = type(settings).model_fields                      # the shipped defaults, whatever this machine's environment sets
    assert defaults["MATCH_QUEUE_MAX_CONCURRENT_JOBS"].default == 0                     # the workers are the bound, not a counter
    assert defaults["MATCH_QUEUE_MAX_JOBS_PER_USER"].default == 3 and defaults["MATCH_QUEUE_MAX_DEPTH"].default == 100
    for name in ("MATCH_QUEUE_MAX_CONCURRENT_JOBS", "MATCH_QUEUE_MAX_JOBS_PER_USER", "MATCH_QUEUE_MAX_DEPTH"):
        monkeypatch.setattr(settings, name, 0)
    for n in range(30):  # 30 submissions at once, several users submitting more than one
        mq.enqueue_match(jd_id=f"jd{n}", jd_text=None, cv_ids=None, weights=None, requested_by=f"user{n % 12}")
    assert mq.queue_depth() == 30
    assert all(mq.try_acquire_slot(f"w{i}") for i in range(500))  # no artificial global cap


def test_every_match_goes_through_one_queue_in_order_whatever_its_size(cache):
    big = mq.enqueue_match(jd_id="big", jd_text=None, cv_ids=["x"] * 5000, weights=None, requested_by="a")
    small = mq.enqueue_match(jd_id="small", jd_text=None, cv_ids=["x"] * 5, weights=None, requested_by="b")
    assert "lane" not in big and "lane" not in small
    assert [mq.queue_position(big["job_id"]), mq.queue_position(small["job_id"])] == [1, 2]
    assert mq.claim_next(1, "w1") == big["job_id"] and mq.claim_next(1, "w2") == small["job_id"]


def test_requeued_job_goes_back_to_the_front(cache):
    first = mq.enqueue_match(jd_id="a", jd_text=None, cv_ids=None, weights=None, requested_by="a")
    mq.enqueue_match(jd_id="b", jd_text=None, cv_ids=None, weights=None, requested_by="b")
    job_id = mq.claim_next(1, "w1")
    mq.requeue_job(job_id, "crash")
    assert mq.claim_next(1, "w2") == first["job_id"]


def test_extra_runner_only_takes_a_job_no_idle_worker_took(cache, monkeypatch):
    """A worker's second runner leaves a fresh job for an idle worker process, and takes it once it has waited."""
    job = _enqueue("alice")
    assert mq.claim_next(1, "w1:1", min_wait_seconds=3) is None          # fresh: left for an idle process
    assert mq.queue_depth() == 1
    real_now = mq._now
    monkeypatch.setattr(mq, "_now", lambda: real_now() + 5)              # nobody took it for 5 s
    assert mq.claim_next(1, "w1:1", min_wait_seconds=3) == job["job_id"]
    assert mq.queue_depth() == 0


def test_heartbeat_recreates_a_lost_lease(cache):
    """If the lease vanished (Redis flushed/restarted), the running job's heartbeat puts it back, so no janitor
    re-queues a job that is still running (which used to run it twice)."""
    assert mq.try_acquire_slot("w1:0")
    cache.redis_client.zsets[mq.LEASES_KEY].clear()
    mq.renew_slot("w1:0")
    assert mq.LEASES_KEY in cache.redis_client.zsets and "w1:0" in cache.redis_client.zsets[mq.LEASES_KEY]
