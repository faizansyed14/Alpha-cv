"""Live events: a notification reaches the person's open tab the moment the change is committed (never before, never for a rolled-back
change), the stream says only "look again", it lets go of the database, it ends on its own, and the clean-up runs once at a time."""
import asyncio
import json
import threading
import time

import pytest

from app.config.settings import settings
from app.models.requirement import Requirement
from app.services import live
from app.services import notifications as svc
from tests.test_notifications import requirement, world  # noqa: F401  (the fixture)


@pytest.fixture
def sent(monkeypatch):
    """What would be published (to Redis): the (user id, kind) pairs of each publish."""
    calls = []
    monkeypatch.setattr(live, "publish", lambda events: calls.append(sorted(events)))
    return calls


def test_the_people_notified_are_told_live_after_the_commit(world, sent):
    r = requirement(world, recruiter_ids=[world.rita.id, world.rob.id], manager_id=world.mgr.id)
    told = sorted(e for batch in sent for e in batch)                  # the commits of that request, all after the requirement was saved
    assert told == sorted([(world.rita.id, "requirement_assigned"), (world.rob.id, "requirement_assigned"), (world.mgr.id, "requirement_assigned")])
    world.as_(world.rita)
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"status": "hold"})
    assert sent[-1] == sorted([(world.mgr.id, "requirement_status"), (world.sales.id, "requirement_status")])


def test_nothing_is_told_before_the_commit_or_for_a_rolled_back_change(world, sent):
    s = world.session
    svc.notify(s, [world.rita.id], "requirement_assigned", "t")
    assert sent == []                                                     # added, not committed: nobody is told yet
    s.rollback()
    s.commit()
    assert sent == []                                                     # rolled back: nobody is ever told
    svc.notify(s, [world.rita.id], "requirement_assigned", "t")
    s.commit()
    assert sent == [[(world.rita.id, "requirement_assigned")]]


def test_reading_tells_the_persons_other_tabs(world, sent):
    requirement(world, recruiter_ids=[world.rita.id])
    world.as_(world.rita)
    sent.clear()
    [n] = world.client.get("/api/notifications").json()["items"]
    world.client.post(f"/api/notifications/{n['id']}/read")
    assert sent == [[(world.rita.id, "read")]]
    world.client.post(f"/api/notifications/{n['id']}/read")             # already read: nothing changed, nothing said
    assert len(sent) == 1
    world.client.post("/api/notifications/read-all")
    assert sent[-1] == [(world.rita.id, "read")]


def test_the_hub_hands_events_to_that_persons_streams_only_and_limits_them():
    async def run():
        hub = live.Hub()
        a, b, other = hub.subscribe("u1"), hub.subscribe("u1"), hub.subscribe("u2")
        assert hub.deliver([("u1", "requirement_closed")]) == 2
        assert a.get_nowait() == {"kind": "requirement_closed"} and b.get_nowait() == {"kind": "requirement_closed"} and other.empty()
        for _ in range(live.QUEUE_SIZE + 5):                               # a slow tab: extra events are dropped, nothing blocks
            hub.deliver([("u2", "notification")])
        assert other.qsize() == live.QUEUE_SIZE
        extra = [hub.subscribe("u3") for _ in range(live.MAX_STREAMS_PER_USER)]
        assert all(extra) and hub.subscribe("u3") is None                  # a runaway client gets no more
        hub.unsubscribe("u1", a); hub.unsubscribe("u1", b)
        assert hub.deliver([("u1", "x")]) == 0
        assert hub.connections() == 1 + live.MAX_STREAMS_PER_USER

    asyncio.run(run())


def test_a_message_from_another_process_is_read_and_junk_is_ignored():
    assert live._parse(json.dumps([{"user": "u1", "kind": "requirement_closed"}, {"kind": "no user"}])) == [("u1", "requirement_closed")]
    assert live._parse("not json") == [] and live._parse(json.dumps({"user": "u1"})) == []


class Events:
    """Reads a stream's events as (name, data), a few at a time, from one iterator (a stream can only be read once)."""

    def __init__(self, response):
        self.chunks, self.buf = response.iter_text(), ""

    def read(self, until, timeout=10):
        """The events until ``until`` of them have come, or the stream ends."""
        out, started = [], time.monotonic()
        while len(out) < until and time.monotonic() - started < timeout:
            while "\n\n" in self.buf and len(out) < until:
                block, self.buf = self.buf.split("\n\n", 1)
                lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
                if "event" in lines:
                    out.append((lines["event"], json.loads(lines.get("data", "{}"))))
            if len(out) >= until:
                break
            chunk = next(self.chunks, None)
            if chunk is None:
                break
            self.buf += chunk
        return out


def test_the_stream_says_ready_then_look_again_and_ends_on_its_own(world, monkeypatch):
    monkeypatch.setattr(live, "_redis_client", lambda: None)              # one process: straight to its own streams
    monkeypatch.setattr(settings, "LIVE_HEARTBEAT_SECONDS", 1)
    monkeypatch.setattr(settings, "LIVE_STREAM_MAX_SECONDS", 3)
    rita, rob = world.rita.id, world.rob.id                               # read now: the stream lets go of the (shared) test session
    world.as_(world.rita)
    with world.client.stream("GET", "/api/notifications/stream") as resp:
        assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/event-stream")
        assert resp.headers["x-accel-buffering"] == "no"
        events = Events(resp)
        first = events.read(1)
        assert first == [("ready", {})]
        threading.Timer(0.2, lambda: live.publish([(rita, "requirement_closed"), (rob, "requirement_closed")])).start()
        rest = events.read(10)
    names = [e[0] for e in rest]
    assert ("notification", {"kind": "requirement_closed"}) in rest       # only what kind of thing: no content
    assert "ping" in names                                                # kept alive between events
    assert live.hub.connections() == 0                                    # it ended by itself and let go


def test_the_stream_gives_its_database_connection_back(world, monkeypatch):
    monkeypatch.setattr(settings, "LIVE_STREAM_MAX_SECONDS", 1)
    monkeypatch.setattr(settings, "LIVE_HEARTBEAT_SECONDS", 1)
    closed = []
    real_close = world.session.close
    monkeypatch.setattr(world.session, "close", lambda: (closed.append(True), real_close()))
    world.as_(world.rita)
    with world.client.stream("GET", "/api/notifications/stream") as resp:
        Events(resp).read(1)
        assert closed                                                     # before the first event was even read


def test_the_clean_up_skips_its_turn_when_another_one_is_running():
    class Engine:
        class dialect:
            name = "postgresql"

    class Result:
        def scalar(self):
            return False                                                   # someone else holds the clean-up lock

    class S:
        def __init__(self, *_a, **_k): self.ran = []
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def execute(self, stmt): self.ran.append(str(stmt)); return Result()

    import app.services.notifications as mod
    original = mod.Session
    mod.Session = S
    try:
        assert mod.purge(Engine()) == 0
    finally:
        mod.Session = original


def test_a_hanging_redis_never_holds_up_the_request_and_is_skipped_for_a_while(monkeypatch):
    """Redis unreachable: the save that notifies returns at once; the event is sent from a background thread, and after one failure
    Redis is not tried again for REDIS_PAUSE_SECONDS (each try could wait seconds), the process's own streams are told instead."""
    tries, delivered = [], []

    class Dead:
        def publish(self, *_a):
            tries.append(1)
            time.sleep(0.3)                                                # a dead server: the connection attempt hangs, then fails
            raise ConnectionError("redis down")

    monkeypatch.setattr(live, "_redis_client", lambda: Dead())
    monkeypatch.setattr(live, "_redis_down_until", 0.0)
    monkeypatch.setattr(live.hub, "deliver_threadsafe", lambda batch: delivered.append(batch))
    started = time.monotonic()
    live.publish([("u1", "requirement_assigned")])
    assert time.monotonic() - started < 0.05                              # the request did not wait
    live._sender.submit(lambda: None).result(timeout=5)                   # the background send is done
    assert tries == [1] and delivered == [[("u1", "requirement_assigned")]]
    live.publish([("u2", "bug_status")])
    live._sender.submit(lambda: None).result(timeout=5)
    assert tries == [1]                                                   # Redis paused: not tried again
    assert delivered[-1] == [("u2", "bug_status")]                        # this process's streams still told


def test_redis_back_after_the_pause_is_used_again(monkeypatch):
    sent = []

    class Up:
        def publish(self, channel, payload):
            sent.append((channel, json.loads(payload)))

    monkeypatch.setattr(live, "_redis_client", lambda: Up())
    monkeypatch.setattr(live, "_redis_down_until", time.monotonic() - 1)  # the pause is over
    live.publish([("u1", "requirement_closed"), ("u1", "requirement_closed")])   # the same event twice: sent once
    live._sender.submit(lambda: None).result(timeout=5)
    assert sent == [(live.CHANNEL, [{"user": "u1", "kind": "requirement_closed"}])]


def test_a_seventh_stream_for_one_person_is_refused(world, monkeypatch):
    monkeypatch.setattr(settings, "LIVE_STREAM_MAX_SECONDS", 1)
    rita = world.rita.id
    queues = []

    async def fill():
        for _ in range(live.MAX_STREAMS_PER_USER):
            queues.append(live.hub.subscribe(rita))
    asyncio.run(fill())
    try:
        world.as_(world.rita)
        r = world.client.get("/api/notifications/stream")
        assert r.status_code == 429
    finally:
        for q in queues:
            live.hub.unsubscribe(rita, q)
    assert live.hub.connections() == 0


def test_a_tab_closed_mid_stream_is_let_go(world, monkeypatch):
    monkeypatch.setattr(settings, "LIVE_HEARTBEAT_SECONDS", 1)
    monkeypatch.setattr(settings, "LIVE_STREAM_MAX_SECONDS", 60)
    world.as_(world.rita)
    with world.client.stream("GET", "/api/notifications/stream") as resp:
        Events(resp).read(1)
        assert live.hub.connections() == 1
    deadline = time.monotonic() + 5                                        # the tab is gone: noticed at the next ping at the latest
    while live.hub.connections() and time.monotonic() < deadline:
        time.sleep(0.1)
    assert live.hub.connections() == 0


def test_a_save_without_notifications_publishes_nothing(world, sent):
    r = requirement(world)                                                # nobody assigned: nobody to tell
    world.client.patch(f"/api/tracker/requirements/{r['id']}", json={"sales_comments": "just a note"})
    assert sent == []
