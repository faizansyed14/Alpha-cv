'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lock, RefreshCw } from '@/components/icons';
import type { LoginBlock, LoginBlocks } from '@/lib/types';

/** "12 min", "45 s": how long until a counter expires on its own. */
function left(seconds: number | null): string {
  if (seconds == null) return '';
  if (seconds >= 120) return `${Math.round(seconds / 60)} min`;
  return `${Math.max(1, seconds)} s`;
}

const KIND: Record<LoginBlock['kind'], { title: string; hint: string }> = {
  username_ip: { title: 'Account from one address', hint: 'Only this person on this computer or network is refused.' },
  account: { title: 'Account, from anywhere', hint: 'Many wrong passwords for this account from different addresses: nobody can sign in to it.' },
  ip: { title: 'Address, any account', hint: 'This address tried too many accounts: every sign-in from it is refused (an office shares one address).' },
};

function who(b: LoginBlock): string {
  if (b.kind === 'ip') return b.ip || 'unknown address';
  if (b.kind === 'account') return b.username || 'unknown account';
  return `${b.username || 'unknown account'} from ${b.ip || 'unknown address'}`;
}

function Row({ b, busy, onUnlock }: { b: LoginBlock; busy: boolean; onUnlock: (b: LoginBlock) => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-slate-50">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ${
          b.blocked ? 'bg-red-50 text-red-600 ring-red-200' : 'bg-amber-50 text-amber-600 ring-amber-200'
        }`}
        aria-hidden
      >
        <Lock className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{who(b)}</p>
        <p className="text-xs text-slate-500" title={KIND[b.kind].hint}>
          {KIND[b.kind].title} · {b.attempts} of {b.limit} wrong tries
          {b.seconds_left != null ? ` · clears in ${left(b.seconds_left)}` : ''}
        </p>
      </div>
      <Badge variant={b.blocked ? 'destructive' : 'secondary'}>{b.blocked ? 'Blocked' : 'Failing'}</Badge>
      <Button variant="secondary" size="sm" onClick={() => onUnlock(b)} disabled={busy}>
        {b.blocked ? 'Unblock' : 'Clear'}
      </Button>
    </li>
  );
}

/**
 * Admin box: the failed sign-in counters that are alive right now. "Blocked" rows have reached their limit, so sign-ins are being refused
 * (that is the "Too many failed attempts" message people see); "Failing" rows are on their way there. Each clears by itself after the lockout
 * time, or the admin can lift it now. This is the sign-in lockout only: the hourly request limit of the API is kept per server process and is not listed.
 */
export default function BlockedSignIns() {
  const [data, setData] = useState<LoginBlocks | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getLoginBlocks());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const unlock = async (b: LoginBlock) => {
    setBusyKey(`${b.kind}|${b.username}|${b.ip}`);
    setProblem(null);
    try {
      await api.unlockLogin({ kind: b.kind, username: b.username, ip: b.ip });
      await load();
    } catch {
      setProblem('Could not lift that block. Please try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const items = data?.items ?? [];
  const blocked = items.filter((i) => i.blocked).length;

  return (
    <div className="mt-2 rounded-xl border border-surface-border bg-paper p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600">
            <Lock className="h-[18px] w-[18px]" />
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Blocked sign-ins{blocked ? <span className="ml-2 text-red-600">({blocked})</span> : null}
            </p>
            <p className="mt-0.5 text-sm text-gray-500">
              After {data?.limits.username_ip ?? 5} wrong passwords an account is refused from that address for {Math.round((data?.lockout_seconds ?? 900) / 60)} minutes.
              The block lifts by itself, or you can lift it now.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />} onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {problem && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>}

      {failed && !data ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Could not load the list. Try Refresh.</p>
      ) : items.length === 0 ? (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          {loading ? 'Loading…' : 'No failed sign-ins right now. Nobody is blocked.'}
        </p>
      ) : (
        <ul className="mt-4 max-h-96 space-y-0.5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5">
          {items.map((b) => (
            <Row key={`${b.kind}|${b.username}|${b.ip}`} b={b} busy={busyKey === `${b.kind}|${b.username}|${b.ip}`} onUnlock={unlock} />
          ))}
        </ul>
      )}
    </div>
  );
}
