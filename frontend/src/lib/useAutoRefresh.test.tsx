import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// the live line is replaced by a hand-driven one: the tests send the events
const live = vi.hoisted(() => ({ listeners: new Set<(e: unknown) => void>() }));
vi.mock('@/lib/liveEvents', () => ({
  onLive: (fn: (e: unknown) => void) => { live.listeners.add(fn); return () => live.listeners.delete(fn); },
  isLive: () => true,
}));
const send = (e: unknown) => live.listeners.forEach((fn) => fn(e));

import { useAutoRefresh } from './useAutoRefresh';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let visibility: DocumentVisibilityState = 'visible';

function mount(refresh: () => void, opts?: Parameters<typeof useAutoRefresh>[1]) {
  function Page() { useAutoRefresh(refresh, opts); return null; }
  act(() => { root.render(createElement(Page)); });
}
const hide = () => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); };
const show = () => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); };

describe('pages that keep themselves fresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    live.listeners.clear();
    visibility = 'visible';
  });

  it('refresh when the reader comes back after 30 s away, not after a glance elsewhere', () => {
    const refresh = vi.fn();
    mount(refresh);
    hide(); vi.advanceTimersByTime(10_000); show();
    expect(refresh).not.toHaveBeenCalled();                       // 10 s away: nothing
    hide(); vi.advanceTimersByTime(31_000); show();
    expect(refresh).toHaveBeenCalledTimes(1);                      // 31 s away: once
    show();
    expect(refresh).toHaveBeenCalledTimes(1);                      // already back: not again
  });

  it('count another window (blur and focus) as being away too', () => {
    const refresh = vi.fn();
    mount(refresh);
    window.dispatchEvent(new Event('blur')); vi.advanceTimersByTime(45_000); window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('blur')); hide(); vi.advanceTimersByTime(40_000); show(); window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(2);                      // blur and hide together are one absence, one refresh
  });

  it('refresh on the live events of their kinds only, several close together making one fetch', () => {
    const refresh = vi.fn();
    mount(refresh, { kinds: ['requirement_*', 'bug_reported'] });
    send({ type: 'notification', kind: 'bug_status' });
    send({ type: 'read' });
    vi.advanceTimersByTime(2_000);
    expect(refresh).not.toHaveBeenCalled();                        // not theirs
    send({ type: 'notification', kind: 'requirement_assigned' });
    send({ type: 'notification', kind: 'requirement_closed' });
    send({ type: 'notification', kind: 'bug_reported' });
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);                      // three at once: one fetch
    send({ type: 'sync' });                                        // the line is back after a gap: look again
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a page that asks for no kinds does not listen to the live line at all', () => {
    mount(vi.fn());
    expect(live.listeners.size).toBe(0);
  });

  it('use the newest refresh (the current filters), and stop when the page is left', () => {
    const first = vi.fn();
    const second = vi.fn();
    mount(first, { kinds: ['requirement_*'] });
    mount(second, { kinds: ['requirement_*'] });                   // the page re-rendered with new filters
    send({ type: 'notification', kind: 'requirement_closed' });
    vi.advanceTimersByTime(1_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    root = createRoot(container);
    expect(live.listeners.size).toBe(0);                           // left the page: no more listening
    hide(); vi.advanceTimersByTime(60_000); show();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
