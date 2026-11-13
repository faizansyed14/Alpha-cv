'use client';

import { ReactNode, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { duration, ease, spring } from '@/lib/motion';
import { ChevronsLeft, ChevronsRight, LogOut, Menu, X } from '@/components/icons';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { clearActiveMatch, loadActiveMatch } from '@/lib/matchRun';
import { getToken } from '@/lib/auth';
import { roleLabel } from '@/lib/roles';
import { getNavigationTabs, NAV_SECTIONS, type NavItem } from '@/lib/navItems';
import MatchingLiveOverlay from '@/components/ui/MatchingLiveOverlay';
import NoticePopup from '@/components/common/NoticePopup';
import MatchTray from '@/components/layout/MatchTray';
import { ModeToggle } from '@/components/layout/ModeToggle';
import TrackerSidebar from '@/components/tracker/TrackerSidebar';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { APP_VERSION } from '@/lib/version';
import {
  workspacePath,
  workspaceFromPath,
  isMatchPath,
  persistWorkspacePath,
  isFullBleedPath,
} from '@/lib/navigation';

interface AppShellProps {
  children: ReactNode;
}

const NAV_WIDTH = 232;
const TRACKER_NAV_WIDTH = 168;
const NAV_WIDTH_COLLAPSED = 68;
const NAV_COLLAPSED_KEY = 'alphacv.navCollapsed';
const TRACKER_NAV_COLLAPSED_KEY = 'alphacv.trackerNavCollapsed';
const BEFORE_TRACKER_KEY = 'alpha_cv_before_tracker';

export default function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    matchingProgress,
    loadCVs,
    loadJDs,
    loadSystemHealth,
    loadSystemStats,
    loadDatabaseView,
    cvs,
    jds,
    totalCVs,
    totalJDs,
    selectedCVs,
    systemHealth,
  } = useAppStore();
  const { user, logout } = useAuthStore();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // The side nav is fixed in width: either full, or collapsed to icons only so the page gets the room.
  const [collapsed, setCollapsed] = useState(false);
  const [trackerCollapsed, setTrackerCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(NAV_COLLAPSED_KEY) === '1');
      setTrackerCollapsed(localStorage.getItem(TRACKER_NAV_COLLAPSED_KEY) === '1');
    } catch {
      /* storage unavailable: stay expanded */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const toggleTrackerCollapsed = () => {
    setTrackerCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TRACKER_NAV_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const currentWorkspace = workspaceFromPath(pathname) ?? 'dashboard';
  const fullBleed = isFullBleedPath(pathname);
  const trackerMode = pathname.replace(/\/$/, '').startsWith('/tracker');   // the tracker is its own workspace: its navigation replaces this one
  const agentic = pathname.replace(/\/$/, '') === '/agentic';          // Agentic mode has no side navigation: it is its own full page
  const navigationTabs = getNavigationTabs(user?.role);
  // where "Back to app" goes: the page the person was on before opening the tracker
  useEffect(() => {
    if (trackerMode) return;
    try { sessionStorage.setItem(BEFORE_TRACKER_KEY, pathname); } catch { /* back falls back to the dashboard */ }
  }, [pathname, trackerMode]);
  const backToApp = () => {
    let to = '/dashboard';
    try { to = sessionStorage.getItem(BEFORE_TRACKER_KEY) || to; } catch { /* ignore */ }
    router.push(to.startsWith('/tracker') ? '/dashboard' : to);
  };
  const [openBugs, setOpenBugs] = useState<number | undefined>(undefined);
  const navCounts: Record<string, number | undefined> = {
    candidates: totalCVs ?? (cvs.length || undefined),
    jobs: totalJDs ?? (jds.length || undefined),
    'admin-bugs': openBugs,
  };

  // The admin sees how many bug reports still wait, kept fresh while the page is open.
  useEffect(() => {
    if (user?.role !== 'admin') return;
    let alive = true;
    const load = () => { api.getOpenBugCount().then((n) => { if (alive) setOpenBugs(n); }).catch(() => {}); };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [user?.role]);

  useEffect(() => {
    if (pathname.replace(/\/$/, '') !== '/agentic') persistWorkspacePath(pathname.replace(/\/$/, '') || '/dashboard');
  }, [pathname]);

  useEffect(() => {
    if ((currentWorkspace === 'candidates' || currentWorkspace === 'jobs' || currentWorkspace === 'database') && cvs.length === 0) {
      loadCVs();
      loadJDs();
    } else if (currentWorkspace === 'system' && !systemHealth) {
      loadSystemHealth();
      loadSystemStats();
      loadDatabaseView();
    }
  }, [currentWorkspace, cvs.length, systemHealth, loadCVs, loadJDs, loadSystemHealth, loadSystemStats, loadDatabaseView]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const beat = () => {
      api.me(token).catch(() => {});
    };
    const id = setInterval(beat, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.username]);

  // A match that was still running when this page was loaded (refresh, closed tab): wait for it again and show its results.
  useEffect(() => {
    if (!user?.username || !loadActiveMatch(user.username)) return;
    void useAppStore.getState().resumeMatch().then((done) => {
      if (done && window.location.pathname.replace(/\/$/, '') !== '/match') router.push('/match');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  const handleLogout = () => {
    clearActiveMatch();
    logout();
    router.push('/login');
  };

  const handleNavigate = (tabId: string) => {
    setMobileNavOpen(false);
    router.push(workspacePath(tabId));
  };

  const navButton = (tab: NavItem, scope: string, compact: boolean) => {
    const id = String(tab.id);
    const active = currentWorkspace === id;
    const Icon = tab.icon;
    const count = navCounts[id];
    const pending = id === 'match' && selectedCVs.length > 0 && !active;
    return (
      <button
        key={id}
        type="button"
        onClick={() => handleNavigate(id)}
        aria-current={active ? 'page' : undefined}
        title={compact ? tab.label : tab.description}
        aria-label={tab.label}
        className={cn(
          'group relative flex h-9 w-full items-center rounded-lg text-sm transition-colors duration-150',
          compact ? 'justify-center px-0' : 'gap-2.5 pl-2.5 pr-2',
          active ? 'font-semibold text-navy-900' : 'font-medium text-slate-600 hover:bg-slate-100/80 hover:text-slate-900',
        )}
      >
        {active ? (
          <motion.span
            layoutId={`nav-pill-${scope}`}
            transition={spring.snappy}
            className="absolute inset-0 rounded-lg bg-navy-50 ring-1 ring-inset ring-navy-100"
          />
        ) : null}
        {active && !compact ? (
          <motion.span layoutId={`nav-bar-${scope}`} transition={spring.snappy} className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-solid-hover" />
        ) : null}
        <span className={cn('relative flex h-6 w-6 shrink-0 items-center justify-center transition-transform duration-200 group-hover:scale-105 group-active:scale-95')}>
          <Icon className={cn('h-[18px] w-[18px] transition-colors duration-150', active ? 'text-navy-800' : 'text-slate-500 group-hover:text-slate-800')} />
        </span>
        {compact ? null : <span className="relative min-w-0 flex-1 truncate text-left">{tab.label}</span>}
        {!compact && typeof count === 'number' && count > 0 ? (
          <span className={cn('relative rounded-md px-1.5 text-2xs font-semibold tabular-nums', active ? 'bg-paper text-navy-800 shadow-soft' : 'text-slate-400')}>
            {count > 9999 ? `${Math.floor(count / 1000)}k` : count.toLocaleString()}
          </span>
        ) : null}
        {pending ? (
          <span
            className={compact
              ? 'absolute right-1 top-1 min-w-[16px] rounded-full bg-solid-soft px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-white'
              : 'relative rounded-md bg-solid-hover px-1.5 text-2xs font-semibold tabular-nums text-white'}
          >
            {selectedCVs.length}
          </span>
        ) : null}
      </button>
    );
  };

  const sections = NAV_SECTIONS
    .map((name) => ({ name, items: navigationTabs.filter((t) => t.section === name) }))
    .filter((g) => g.items.length > 0);

  const sidebar = (scope: string, closable: boolean) => {
    const compact = collapsed && !closable;   // the phone drawer is always full
    return (
    <LayoutGroup id={scope}>
      <div className="glass-nav relative flex h-full flex-col overflow-hidden border-r border-surface-border/70">
        {/* brand */}
        <div className={cn('relative flex h-14 shrink-0 items-center', compact ? 'justify-center px-2' : 'justify-between pl-4 pr-2')}>
          <button type="button" onClick={() => handleNavigate('dashboard')} className="flex min-w-0 items-center gap-2.5" aria-label="Alpha CV home" title={`Alpha CV v${APP_VERSION}`}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-paper shadow-raised ring-1 ring-slate-200">
              <img src="/alphadatalogo.svg" alt="" className="h-5 w-5 object-contain" />
            </span>
            {compact ? null : (
              <span className="flex min-w-0 flex-col items-start leading-none">
                <span className="truncate font-display text-[17px] font-semibold tracking-[-0.03em] text-slate-900">
                  Alpha<span className="text-navy-700">CV</span>
                </span>
                <span className="mt-1 text-2xs font-medium tracking-wide text-slate-400">v{APP_VERSION}</span>
              </span>
            )}
          </button>
          {closable ? (
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
              aria-label="Close navigation"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <nav className={cn('relative min-h-0 flex-1 overflow-y-auto pb-3 pt-1', compact ? 'space-y-2 px-3' : 'space-y-4 px-3')} aria-label="Main">
          {sections.map((group, gi) => (
            <div key={group.name} className="space-y-0.5">
              {compact ? (
                gi > 0 ? <div className="mx-2 mb-1.5 border-t border-surface-border/80" /> : null
              ) : (
                <div className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">{group.name}</div>
              )}
              {group.items.map((tab) => navButton(tab, scope, compact))}
            </div>
          ))}
        </nav>

        {/* person */}
        {user && (
          compact ? (
            <div className="relative m-2 flex shrink-0 flex-col items-center gap-1.5 rounded-xl border border-slate-200/80 bg-paper/80 p-2 shadow-soft">
              <span title={`${user.username} (${roleLabel(user.role)})`}>
                <Avatar name={user.username} />
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
          <div className="relative m-3 shrink-0 rounded-xl border border-slate-200/80 bg-paper/80 p-2 shadow-soft">
            <div className="flex items-center gap-2.5">
              <Avatar name={user.username} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900">{user.username}</div>
                <div className="truncate text-2xs text-slate-500">{roleLabel(user.role)}</div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
          )
        )}
      </div>
    </LayoutGroup>
    );
  };

  return (
    <div className="relative isolate flex min-h-screen bg-[var(--app-bg)]">
      <aside
        className={cn('sticky top-0 z-20 hidden h-screen shrink-0 transition-[width] duration-200 ease-out', agentic ? '' : 'lg:block')}
        style={{
          width: trackerMode
            ? (trackerCollapsed ? NAV_WIDTH_COLLAPSED : TRACKER_NAV_WIDTH)
            : (collapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH),
        }}
      >
        {trackerMode
          ? <TrackerSidebar user={user} onBack={backToApp} onLogout={handleLogout} collapsed={trackerCollapsed} />
          : sidebar('desktop', false)}
        {!agentic && (
          <button
            type="button"
            onClick={trackerMode ? toggleTrackerCollapsed : toggleCollapsed}
            aria-label={(trackerMode ? trackerCollapsed : collapsed) ? 'Expand navigation' : 'Collapse navigation'}
            title={(trackerMode ? trackerCollapsed : collapsed) ? 'Expand navigation' : 'Collapse navigation'}
            className="absolute -right-3 top-[18px] z-30 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-paper text-slate-500 shadow-raised transition-colors hover:text-navy-800"
          >
            {(trackerMode ? trackerCollapsed : collapsed)
              ? <ChevronsRight className="h-3 w-3" />
              : <ChevronsLeft className="h-3 w-3" />}
          </button>
        )}
      </aside>

      <AnimatePresence>
        {mobileNavOpen ? (
          <div key="mobile-nav" className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-scrim/45 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: duration.base, ease }}
              onClick={() => setMobileNavOpen(false)}
              aria-hidden
            />
            <motion.aside
              className={cn('absolute inset-y-0 left-0 shadow-pop', trackerMode ? 'w-[200px]' : 'w-[280px]')}
              initial={{ x: trackerMode ? -200 : -280 }}
              animate={{ x: 0 }}
              exit={{ x: trackerMode ? -200 : -280, transition: { duration: duration.base, ease } }}
              transition={spring.soft}
            >
              {trackerMode ? <TrackerSidebar user={user} onBack={backToApp} onLogout={handleLogout} onClose={() => setMobileNavOpen(false)} /> : sidebar('mobile', true)}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>

      <main className={cn('relative flex min-w-0 flex-1 flex-col', fullBleed ? 'h-dvh overflow-hidden' : '')}>
        {!agentic && (
          <div className="glass sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-surface-border/60 px-3 lg:hidden">
            <button
              type="button"
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <img src="/alphadatalogo.svg" alt="" className="h-7 w-7 rounded-md object-contain" />
            <span className="font-display text-md font-semibold tracking-[-0.03em] text-slate-900">Alpha<span className="text-navy-700">CV</span></span>
            <ModeToggle />
          </div>
        )}
        {!fullBleed && !trackerMode && (
          <div className="hidden h-12 shrink-0 items-center justify-end gap-2 px-4 lg:flex lg:px-8">
            <ModeToggle />
          </div>
        )}
        {fullBleed ? (
          <div className="min-h-0 flex-1">{children}</div>
        ) : (
          <div className={cn('mx-auto w-full min-w-0 flex-1 px-3 pb-28 pt-2 sm:px-6 lg:pt-3', trackerMode ? 'max-w-none lg:px-3' : 'max-w-[1600px] lg:px-8')}>{children}</div>
        )}
      </main>

      <NoticePopup />
      <MatchTray />

      <MatchingLiveOverlay
        totalCVs={matchingProgress.totalCVs}
        processedCVs={matchingProgress.processedCVs}
        currentStage={matchingProgress.currentStage}
        estimatedTimeRemaining={matchingProgress.estimatedTimeRemaining}
        isVisible={matchingProgress.isVisible && !isMatchPath(pathname)}
        currentBatch={matchingProgress.currentBatch}
        totalBatches={matchingProgress.totalBatches}
        phase={matchingProgress.phase}
        currentCandidate={matchingProgress.currentCandidate}
        recentCandidates={matchingProgress.recentCandidates}
        percent={matchingProgress.percent ?? 0}
        llmDone={matchingProgress.llmDone ?? 0}
        llmTotal={matchingProgress.llmTotal ?? 0}
      />
    </div>
  );
}
