import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A server-sent-events body that sends `chunks` and then stays open until the request is aborted. */
function streamBody(chunks: string[], signal: AbortSignal) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      signal.addEventListener('abort', () => { try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* closed */ } });
    },
  });
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('the live line', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.setItem('auth_token', 'tok');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('opens with the first listener, passes on what arrives (split anywhere) and closes with the last', async () => {
    const auth = await import('./auth');
    vi.spyOn(auth, 'getToken').mockReturnValue('tok');
    const calls: { url: string; auth: string | null; signal: AbortSignal }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      calls.push({ url, auth: new Headers(init.headers).get('Authorization'), signal });
      return new Response(streamBody([
        'retry: 3000\n\nevent: ready\ndata: {}\n\n',
        'event: notif', 'ication\ndata: {"kind": "requirement_assigned"}\n\n',           // an event split across two chunks
        'event: ping\ndata: {}\n\nevent: read\ndata: {"kind": "read"}\n\n',
      ], signal), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }));
    const live = await import('./liveEvents');
    const got: unknown[] = [];
    const off = live.onLive((e) => got.push(e));
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/api\/notifications\/stream$/);
    expect(calls[0].auth).toBe('Bearer tok');
    expect(got).toEqual([{ type: 'notification', kind: 'requirement_assigned' }, { type: 'read' }]);   // ready and ping only say "alive"
    expect(live.isLive()).toBe(true);
    const second = live.onLive(() => undefined);
    await flush();
    expect(calls).toHaveLength(1);                                        // one line, however many listeners
    off();
    second();
    expect(calls[0].signal.aborted).toBe(true);                           // the last one gone: the line is closed
    expect(live.isLive()).toBe(false);
  });

  it('a tab that is not the one holding the line opens none, and hears what the holder shares', async () => {
    const auth = await import('./auth');
    vi.spyOn(auth, 'getToken').mockReturnValue('tok');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // another tab holds the lock: this tab's request waits (until it is aborted)
    const request = vi.fn((_name: string, opts: { signal: AbortSignal }) => new Promise<void>((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    const live = await import('./liveEvents');
    const got: unknown[] = [];
    const off = live.onLive((e) => got.push(e));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();                              // one connection per browser: the other tab's
    const holder = new BroadcastChannel('alphacv-live');                  // what the holding tab shares
    holder.postMessage({ type: 'alive' });
    holder.postMessage({ type: 'notification', kind: 'bug_status' });
    await flush();
    expect(got).toEqual([{ type: 'notification', kind: 'bug_status' }]);
    expect(live.isLive()).toBe(true);
    holder.close();
    off();
  });

  it('when the server ends the stream on schedule it opens the next one at once and says "sync" to fetch anything missed', async () => {
    const auth = await import('./auth');
    vi.spyOn(auth, 'getToken').mockReturnValue('tok');
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      n += 1;
      if (n === 1) return new Response('event: ready\ndata: {}\n\n', { status: 200 });          // ends right after: the 15-minute end
      return new Response(streamBody(['event: ready\ndata: {}\n\n'], init.signal as AbortSignal), { status: 200 });
    }));
    const live = await import('./liveEvents');
    const got: unknown[] = [];
    const off = live.onLive((e) => got.push(e));
    await new Promise((r) => setTimeout(r, 600));
    expect(n).toBe(2);
    expect(got).toEqual([{ type: 'sync' }]);                               // not on the first connect: only after a gap
    off();
  });

  it('when the network fails it tries again, waiting a little longer each time', async () => {
    const auth = await import('./auth');
    vi.spyOn(auth, 'getToken').mockReturnValue('tok');
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    try {
      const live = await import('./liveEvents');
      const off = live.onLive(() => undefined);
      await vi.advanceTimersByTimeAsync(10);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_300);                            // ~1 s
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_300);
      expect(fetchMock).toHaveBeenCalledTimes(2);                          // the next wait is ~3 s, not 1 s
      await vi.advanceTimersByTimeAsync(2_500);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(live.isLive()).toBe(false);
      off();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);                          // stopped: no more tries
    } finally {
      vi.useRealTimers();
    }
  });

  it('signed out: it does not connect until there is a sign-in', async () => {
    const auth = await import('./auth');
    vi.spyOn(auth, 'getToken').mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const live = await import('./liveEvents');
    const off = live.onLive(() => undefined);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    off();
  });

  it('when the server refuses the sign-in it waits instead of hammering it', async () => {
    const auth = await import('./auth');
    vi.spyOn(auth, 'getToken').mockReturnValue('expired');
    const fetchMock = vi.fn(async () => new Response('no', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const live = await import('./liveEvents');
    const off = live.onLive(() => undefined);
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(live.isLive()).toBe(false);
    off();
  });
});
