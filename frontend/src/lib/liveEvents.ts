'use client';
/**
 * The live line to the server (GET /api/notifications/stream, server-sent events): "something for you was just saved, look again".
 *
 * - ONE connection per browser, whatever the number of tabs: the tabs elect one of them (Web Locks) to hold the stream, and it shares
 *   what arrives with the others (BroadcastChannel). When that tab closes, another takes over within a moment. Browsers without Web
 *   Locks simply open one stream per tab.
 * - The stream carries no content, only who should look and what kind of thing happened; the pages then fetch what they show.
 * - After a drop it reconnects on its own (quickly at first, then backing off), and says `sync` when it is back, so whatever happened
 *   meanwhile is fetched too. The server ends each stream after 15 minutes and a new one is opened (that checks the sign-in again).
 * - `isLive()` tells the pages whether the line is up, so they only fall back to checking on a timer when it is not.
 */
import { getToken } from '@/lib/auth';
import { getApiBaseUrl } from '@/lib/config';

export type LiveEvent =
  | { type: 'notification'; kind: string }   // a notification for this person was saved (kind: requirement_assigned, bug_status ...)
  | { type: 'read' }                         // they read one in another tab or device: the count changed
  | { type: 'sync' };                        // the line is back after a gap: look again once
type Wire = LiveEvent | { type: 'alive' };
type Listener = (e: LiveEvent) => void;

const CHANNEL = 'alphacv-live';
const LOCK = 'alphacv-live-stream';
const ALIVE_MS = 70_000;                     // the server pings every 25 s: a minute without one means the line is down
const BACKOFF_MS = [1_000, 3_000, 10_000, 30_000, 60_000];

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
let stopper: AbortController | null = null;
let lastAlive = 0;

/** True while this browser's live line is up (in this tab or the tab that holds it). */
export function isLive(): boolean {
  return Date.now() - lastAlive < ALIVE_MS;
}

function receive(e: Wire) {
  lastAlive = Date.now();
  if (e.type === 'alive') return;
  listeners.forEach((fn) => {
    try { fn(e); } catch { /* one page's handler never stops the others */ }
  });
}

/** What the tab holding the stream heard: for itself, and for the other tabs. */
function share(e: Wire) {
  receive(e);
  try { channel?.postMessage(e); } catch { /* the channel closed with the page */ }
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const t = window.setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { window.clearTimeout(t); resolve(); }, { once: true });
});

/** Hold the stream until `signal` aborts: connect, read, and reconnect after a drop. */
async function holdStream(signal: AbortSignal): Promise<void> {
  let failures = 0;
  let connectedBefore = false;
  while (!signal.aborted) {
    const token = getToken();
    if (!token) { await sleep(30_000, signal); continue; }            // signed out in this browser: nothing to listen for
    let ended = false;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/notifications/stream`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, cache: 'no-store', signal,
      });
      if (res.status === 401 || res.status === 403) { await sleep(60_000, signal); continue; }   // the sign-in ended: wait for a new one
      if (!res.ok || !res.body) throw new Error(`live stream: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) { ended = true; break; }
        buf += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          let name = '';
          let data = '{}';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) name = line.slice(7).trim();
            else if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (name === 'ready') {
            failures = 0;
            share({ type: 'alive' });
            if (connectedBefore) share({ type: 'sync' });             // back after a gap: anything missed is fetched now
            connectedBefore = true;
          } else if (name === 'ping') {
            share({ type: 'alive' });
          } else if (name === 'read') {
            share({ type: 'read' });
          } else if (name === 'notification') {
            let kind = 'notification';
            try { kind = String(JSON.parse(data)?.kind || kind); } catch { /* keep the generic kind */ }
            share({ type: 'notification', kind });
          }
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    if (signal.aborted) return;
    if (ended) { await sleep(300, signal); continue; }                 // the server closed it on schedule: open the next one at once
    const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
    failures += 1;
    await sleep(wait * (0.8 + Math.random() * 0.4), signal);           // spread out, so a restarted server is not hit by every tab at once
  }
}

function start() {
  if (stopper || typeof window === 'undefined') return;
  stopper = new AbortController();
  const signal = stopper.signal;
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (m: MessageEvent<Wire>) => { if (m.data && typeof m.data === 'object') receive(m.data); };
  }
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks && channel) {
    // the tab that gets the lock holds the stream until it closes or stops listening; the others wait their turn
    locks.request(LOCK, { signal }, () => holdStream(signal)).catch(() => undefined);
  } else {
    void holdStream(signal);
  }
}

function stop() {
  stopper?.abort();
  stopper = null;
  channel?.close();
  channel = null;
  lastAlive = 0;
}

/** Listen for live events while `fn` is subscribed. The line opens with the first listener and closes with the last. */
export function onLive(fn: Listener): () => void {
  listeners.add(fn);
  start();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) stop();
  };
}
