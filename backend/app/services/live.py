"""Live events to the browser tabs that are open: "you have a new notification", the moment it is saved, without the tab asking.

How it works
* A tab opens one long-lived stream (``GET /api/notifications/stream``, server-sent events). In the browser only one tab per person
  holds it and shares what arrives with the others, so ten open tabs are still one connection.
* Each API process keeps its open streams in ``hub`` (in memory): user id -> the queues of that person's streams on this process.
* ``publish`` is called after a change is COMMITTED (see ``app.services.notifications``). It sends one small message on a Redis channel;
  every API process listens to that channel once (``run_subscriber``) and hands the message to the streams it holds. So it does not
  matter which process or server saved the change and which one holds the person's stream.
* Without Redis the message goes straight to this process's own streams; a tab connected to another process then learns of it from its
  occasional safety check instead, a few minutes later. Nothing is ever lost: the stream only says "look again", the data is in the
  database.

The message carries no content, only who should look and what kind of thing happened ({"user": id, "kind": "requirement_assigned"}),
so nothing private passes through Redis.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Iterable, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

CHANNEL = "alphacv:live"
QUEUE_SIZE = 16                     # events waiting for one slow stream; beyond that they are dropped (each one only says "look again")
MAX_STREAMS_PER_USER = 6           # tabs normally share one; this only stops a runaway client


class Hub:
    """The open streams of this process, by person."""

    def __init__(self) -> None:
        self._subs: Dict[str, Set[asyncio.Queue]] = {}
        self._lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def subscribe(self, user_id: str) -> Optional[asyncio.Queue]:
        """A queue for one new stream, or None when this person already has too many open."""
        with self._lock:
            self._loop = asyncio.get_running_loop()
            queues = self._subs.setdefault(user_id, set())
            if len(queues) >= MAX_STREAMS_PER_USER:
                return None
            q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
            queues.add(q)
            return q

    def unsubscribe(self, user_id: str, q: asyncio.Queue) -> None:
        with self._lock:
            queues = self._subs.get(user_id)
            if queues is not None:
                queues.discard(q)
                if not queues:
                    del self._subs[user_id]

    def connections(self) -> int:
        with self._lock:
            return sum(len(q) for q in self._subs.values())

    def deliver(self, events: Iterable[Tuple[str, str]]) -> int:
        """Put each (user id, kind) on that person's streams. Must run on the event loop. Returns how many streams were reached."""
        reached = 0
        for user_id, kind in events:
            with self._lock:
                queues = list(self._subs.get(user_id, ()))
            for q in queues:
                try:
                    q.put_nowait({"kind": kind})
                    reached += 1
                except asyncio.QueueFull:
                    pass                    # it already has plenty to tell its tab: "look again" once is enough
        return reached

    def deliver_threadsafe(self, events: List[Tuple[str, str]]) -> None:
        """``deliver`` from any thread (a request handled in the thread pool): handed over to the event loop."""
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.get_running_loop()
            on_loop = True
        except RuntimeError:
            on_loop = False
        if on_loop:
            self.deliver(events)
        else:
            loop.call_soon_threadsafe(self.deliver, events)


hub = Hub()


def _redis_client():
    """The shared synchronous Redis client, or None when Redis is not reachable."""
    try:
        from app.providers.cache.redis import get_redis_cache

        cache = get_redis_cache()
        return cache.redis_client if cache.is_connected and cache.redis_client is not None else None
    except Exception:  # noqa: BLE001
        return None


REDIS_PAUSE_SECONDS = 15.0          # after Redis fails, this long without trying it (each try could wait seconds for a dead server)
_sender = ThreadPoolExecutor(max_workers=1, thread_name_prefix="live-publish")
_redis_down_until = 0.0


def publish(events: Iterable[Tuple[str, str]]) -> None:
    """Tell the people concerned, wherever their tab is connected. ``events``: (user id, kind). Returns at once: the sending happens on a
    background thread, so the request that saved the change never waits for Redis (a Redis that is down could otherwise hold it for
    seconds). Never raises: a live event is a courtesy, the notification itself is already saved."""
    batch = sorted({(u, k) for u, k in events if u})
    if not batch:
        return
    try:
        _sender.submit(_send, batch)
    except RuntimeError:                  # the process is shutting down
        pass


def _send(batch: List[Tuple[str, str]]) -> None:
    global _redis_down_until
    if time.monotonic() >= _redis_down_until:
        client = _redis_client()
        if client is not None:
            try:
                client.publish(CHANNEL, json.dumps([{"user": u, "kind": k} for u, k in batch]))
                return                      # every API process, this one included, receives it from the channel
            except Exception as exc:  # noqa: BLE001
                _redis_down_until = time.monotonic() + REDIS_PAUSE_SECONDS
                logger.warning("Could not publish a live event to Redis (%s); this process's own streams only for %.0fs",
                               exc.__class__.__name__, REDIS_PAUSE_SECONDS)
    hub.deliver_threadsafe(batch)


def _parse(raw: str) -> List[Tuple[str, str]]:
    try:
        items = json.loads(raw)
        return [(str(i["user"]), str(i.get("kind") or "notification")) for i in items if isinstance(i, dict) and i.get("user")]
    except Exception:  # noqa: BLE001 - something else on the channel: ignored
        return []


async def run_subscriber() -> None:
    """One per API process, for its whole life: listen to the Redis channel and hand each message to this process's streams. Reconnects
    on its own (Redis restarted, network blip); without Redis it waits and tries again, and the tabs fall back to their safety checks."""
    from redis import asyncio as aioredis

    from app.config.settings import settings

    hub._loop = asyncio.get_running_loop()
    delay = 1.0
    while True:
        client = None
        try:
            client = aioredis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, db=0, password=settings.REDIS_PASSWORD or None,
                                    username=settings.REDIS_USERNAME or None, decode_responses=True, socket_connect_timeout=5,
                                    health_check_interval=30)
            pubsub = client.pubsub(ignore_subscribe_messages=True)
            await pubsub.subscribe(CHANNEL)
            logger.info("Live events: listening on Redis")
            delay = 1.0
            async for message in pubsub.listen():
                if message and message.get("type") == "message":
                    hub.deliver(_parse(message.get("data") or ""))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("Live events: Redis subscription lost (%s); retrying in %.0fs", exc.__class__.__name__, delay)
        finally:
            if client is not None:
                try:
                    await (client.aclose() if hasattr(client, "aclose") else client.close())
                except Exception:  # noqa: BLE001
                    pass
        await asyncio.sleep(delay)
        delay = min(delay * 2, 30.0)
