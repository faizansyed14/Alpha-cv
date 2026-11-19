"""After Redis goes down the process uses its in-memory fallback at once, and switches back to Redis by itself when Redis answers again
(it used to stay on the fallback until restarted). Nobody waits for the check."""
import time

from app.providers.cache.redis import RedisCacheService


class FakeRedis:
    def __init__(self):
        self.up = True
        self.pings = 0
        self.slow = 0.0

    def ping(self):
        self.pings += 1
        time.sleep(self.slow)
        if not self.up:
            raise ConnectionError("down")
        return True


def service(client):
    svc = RedisCacheService.__new__(RedisCacheService)
    svc.redis_client = client
    svc.is_connected = True
    return svc


def wait_for(cond, timeout=3.0):
    end = time.monotonic() + timeout
    while not cond() and time.monotonic() < end:
        time.sleep(0.02)
    return cond()


def test_it_comes_back_by_itself_once_redis_answers(monkeypatch):
    monkeypatch.setattr(RedisCacheService, "RECONNECT_SECONDS", 0.1)
    redis = FakeRedis()
    svc = service(redis)
    redis.up = False
    svc.is_connected = False                                # a failed call marked it down
    assert svc.is_connected is False                        # too soon: not even tried yet
    time.sleep(0.15)
    assert svc.is_connected is False                        # tried in the background: still down
    assert wait_for(lambda: redis.pings >= 1)
    redis.up = True
    time.sleep(0.15)
    svc.is_connected                                        # the next call starts another check...
    assert wait_for(lambda: svc.is_connected is True)       # ...and Redis is used again


def test_a_caller_never_waits_for_the_check_and_checks_never_pile_up(monkeypatch):
    monkeypatch.setattr(RedisCacheService, "RECONNECT_SECONDS", 0.0)
    redis = FakeRedis()
    svc = service(redis)
    redis.up, redis.slow = False, 0.5                       # a dead server that makes each ping hang
    svc.is_connected = False
    svc.__dict__["_down_since"] = 0.0
    started = time.monotonic()
    for _ in range(50):
        assert svc.is_connected is False
    assert time.monotonic() - started < 0.2                 # 50 calls, no waiting
    assert wait_for(lambda: redis.pings == 1, 1.0)
    assert redis.pings == 1                                 # one check at a time, however many calls


def test_never_configured_means_never_tried():
    svc = RedisCacheService.__new__(RedisCacheService)
    svc.redis_client = None
    svc.is_connected = False
    assert svc.is_connected is False
    assert "_last_reconnect" not in svc.__dict__ and not svc.__dict__.get("_reconnecting")
