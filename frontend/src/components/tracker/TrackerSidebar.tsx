'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, BarChart3, CheckCircle2, ClipboardList, LogOut, Trophy, X } from '@/components/icons';
import { Avatar } from '@/components/ui/avatar';
import { roleLabel } from '@/lib/roles';
import type { UserProfile } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The tracker's own side navigation. While the tracker is open it takes the place of the main application's side navigation, so the
 * tables have the whole width. "Back to the app" returns to where the person came from.
 */
export default function TrackerSidebar({ user, onBack, onLogout, onClose, collapsed = false }: {
  user: UserProfile | null;
  onBack: () => void;
  onLogout: () => void;
  /** Given on a phone, where the navigation is a drawer: called to close it */
  onClose?: () => void;
  /** Desktop only: icons-only rail so the requirements table gets more width */
  collapsed?: boolean;
}) {
  const pathname = (usePathname() || '').replace(/\/$/, '');
  const mine = user?.role === 'user';
  const compact = collapsed && !onClose;

  const items = [
    { href: '/tracker', label: mine ? 'My requirements' : 'Requirements', hint: mine ? 'Assigned to you' : 'Open work', icon: ClipboardList },
    { href: '/tracker/closures', label: mine ? 'My closures' : 'Closures', hint: mine ? 'What you closed' : 'Closed, by recruiter', icon: Trophy },
    // what became of the closed requirements: not for recruiters
    ...(mine ? [] : [{ href: '/tracker/selections', label: 'Selections', hint: 'Selections & joining', icon: CheckCircle2 }]),
    { href: '/tracker/analytics', label: mine ? 'My analytics' : 'Analytics', hint: mine ? 'Your performance' : 'Recruiter performance', icon: BarChart3 },
  ];

  return (
    <div className="glass-nav relative flex h-full flex-col overflow-hidden border-r border-surface-border/70">
      <div className={cn('flex h-12 shrink-0 items-center gap-1', compact ? 'justify-center px-1' : 'justify-between px-2')}>
        <button
          type="button"
          onClick={() => { onClose?.(); onBack(); }}
          title="Back to app"
          aria-label="Back to app"
          className={cn(
            'inline-flex items-center rounded-lg text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900',
            compact ? 'p-2' : 'min-w-0 gap-1 px-1.5 py-1.5 text-xs font-semibold',
          )}
        >
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
          {compact ? null : <span className="truncate">Back</span>}
        </button>
        {onClose ? (
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900" aria-label="Close navigation">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <nav className={cn('min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2 pt-1', compact ? 'px-1.5' : 'px-2')} aria-label="Tracker">
        {items.map((it) => {
          const active = it.href === '/tracker' ? pathname === '/tracker' : pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={onClose}
              title={compact ? it.label : it.hint}
              aria-label={it.label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center rounded-lg transition-colors',
                compact ? 'justify-center px-2 py-2.5' : 'gap-2 px-2 py-2 text-xs',
                active ? 'bg-navy-50 font-semibold text-navy-900 ring-1 ring-inset ring-navy-100' : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              )}
            >
              <it.icon className="h-4 w-4 shrink-0" />
              {compact ? null : <span className="min-w-0 truncate leading-tight">{it.label}</span>}
            </Link>
          );
        })}
      </nav>

      {user && (
        compact ? (
          <div className="relative m-1.5 flex shrink-0 flex-col items-center gap-1 rounded-lg border border-slate-200/80 bg-paper/80 p-1.5 shadow-soft">
            <span title={`${user.username} (${roleLabel(user.role)})`}>
              <Avatar name={user.username} size="sm" />
            </span>
            <button type="button" onClick={onLogout} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600" title="Sign out" aria-label="Sign out">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="relative m-2 shrink-0 rounded-lg border border-slate-200/80 bg-paper/80 p-1.5 shadow-soft">
            <div className="flex items-center gap-1.5">
              <Avatar name={user.username} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-slate-900">{user.username}</div>
                <div className="truncate text-2xs text-slate-500">{roleLabel(user.role)}</div>
              </div>
              <button type="button" onClick={onLogout} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600" title="Sign out" aria-label="Sign out">
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
