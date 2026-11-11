'use client';
import { roleLabel, type Role } from '@/lib/roles';

import { ReactNode, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { duration, ease, spring } from '@/lib/motion';
import {
  LayoutDashboard,
  Upload,
  Target,
  Menu,
  ChevronLeft,
  ChevronRight,
  X,
  Users,
  LogOut,
  FileText,
  Globe2,
  Activity,
  Shield,
  MessageSquare,
  Megaphone,
  Cpu,
  Bug,
  Bookmark,
} from '@/components/icons';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useSavedCvsStore } from '@/stores/savedCvsStore';
import { api } from '@/lib/api';
import { clearActiveMatch, loadActiveMatch } from '@/lib/matchRun';
import { getToken } from '@/lib/auth';
import MatchingLiveOverlay from '@/components/ui/MatchingLiveOverlay';
import NoticePopup from '@/components/common/NoticePopup';
import MatchTray from '@/components/layout/MatchTray';
import { ModeToggle } from '@/components/layout/ModeToggle';
import { Avatar } from '@/components/ui/avatar';
import {
  workspacePath,
  workspaceFromPath,
  isMatchPath,
  persistWorkspacePath,
  type WorkspaceId,
  isFullBleedPath,
} from '@/lib/navigation';

interface AppShellProps {
  children: ReactNode;
}

interface TabItem {
  id: WorkspaceId | string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  section: 'Recruiting' | 'Hiring' | 'AI agents' | 'Administration' | 'Support';
}

const NAV_WIDTH = 188;
const NAV_WIDTH_COLLAPSED = 64;
const NAV_COLLAPSED_KEY = 'alphacv.navCollapsed';

const REPORT_BUG_TAB: TabItem = { id: 'report-bug', label: 'Report a bug', icon: Bug, description: 'Tell us something is not working', section: 'Support' };

const getNavigationTabs = (userRole?: Role): TabItem[] => {
  const tabs: TabItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Overview and quick actions', section: 'Recruiting' },
    { id: 'candidates', label: 'Candidates', icon: Users, description: 'Browse and select CVs', section: 'Recruiting' },
    { id: 'saved', label: 'Saved CVs', icon: Bookmark, description: 'Your saved candidates: select and match them', section: 'Recruiting' },
    { id: 'jobs', label: 'Job descriptions', icon: FileText, description: 'Browse and select a JD', section: 'Recruiting' },
    { id: 'match', label: 'Match', icon: Target, description: 'AI matching results', section: 'Recruiting' },
    { id: 'upload', label: 'Upload', icon: Upload, description: 'Upload documents', section: 'Recruiting' },
  ];

  if (userRole) {
    tabs.push({ id: 'careers', label: 'Careers', icon: Globe2, description: 'Manage job postings', section: 'Hiring' });
  }
  if (userRole) {
    tabs.push({ id: 'agent-interview', label: 'Interview questions', icon: MessageSquare, description: 'AI agent: interview questions for a job', section: 'AI agents' });
    tabs.push({ id: 'agent-linkedin', label: 'LinkedIn post', icon: Megaphone, description: 'AI agent: a LinkedIn post for a job', section: 'AI agents' });
  }
  if (userRole === 'admin') {
    tabs.push({ id: 'admin', label: 'Users', icon: Shield, description: 'User management & database tools', section: 'Administration' });
    tabs.push({ id: 'monitor', label: 'Monitor', icon: Activity, description: 'Model calls, matching flow & system health', section: 'Administration' });
    tabs.push({ id: 'agent-usage', label: 'Agent usage', icon: Cpu, description: 'AI agent token use per person, with reset', section: 'Administration' });
    tabs.push({ id: 'admin-bugs', label: 'Bug reports', icon: Bug, description: 'What users reported, with status and replies', section: 'Administration' });
  }
  tabs.push(REPORT_BUG_TAB);
  return tabs;
};

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

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(NAV_COLLAPSED_KEY) === '1');
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

  const currentWorkspace = workspaceFromPath(pathname) ?? 'dashboard';
  const fullBleed = isFullBleedPath(pathname);
  const agentic = pathname.replace(/\/$/, '') === '/agentic';          // Agentic mode has no side navigation: it is its own full page
  const navigationTabs = getNavigationTabs(user?.role);
  const [openBugs, setOpenBugs] = useState<number | undefined>(undefined);
  const savedCount = useSavedCvsStore((s) => s.ids.length);
  const loadSaved = useSavedCvsStore((s) => s.load);
  const canSave = !!user;
  useEffect(() => {
    if (canSave) void loadSaved(true);           // each person's own list: read again when someone else signs in
  }, [canSave, user?.username, loadSaved]);
  const navCounts: Record<string, number | undefined> = {
    candidates: totalCVs ?? (cvs.length || undefined),
    jobs: totalJDs ?? (jds.length || undefined),
    'admin-bugs': openBugs,
    saved: savedCount || undefined,
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
    useSavedCvsStore.getState().reset();
    logout();
    router.push('/login');
  };

  const handleNavigate = (tabId: string) => {
    setMobileNavOpen(false);
    router.push(workspacePath(tabId));
  };

  const navButton = (tab: TabItem, scope: string, compact: boolean) => {
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
        className={`group relative flex h-11 w-full items-center rounded-xl border text-[13.5px] transition-colors duration-150 ${compact ? 'justify-center px-0' : 'gap-3 px-3'} ${
          active ? 'border-navy-300 font-medium text-navy-700' : 'border-transparent font-normal text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        {active ? (
          <motion.span layoutId={`nav-pill-${scope}`} transition={spring.snappy} className="absolute inset-0 rounded-xl bg-navy-50/70" />
        ) : null}
        <motion.span
          className="relative flex h-6 w-6 shrink-0 items-center justify-center"
          whileHover={{ scale: 1.14, y: -1 }}
          whileTap={{ scale: 0.92 }}
          animate={active ? { scale: [1, 1.1, 1], rotate: [0, -6, 6, 0] } : { scale: 1, rotate: 0 }}
          transition={
            active
              ? { duration: 0.55, ease, times: [0, 0.35, 0.7, 1] }
              : { type: 'spring', stiffness: 420, damping: 22 }
          }
        >
          <Icon
            className={`h-5 w-5 transition-colors duration-150 ${
              active ? 'text-navy-700' : 'text-slate-500 group-hover:text-slate-800'
            }`}
          />
        </motion.span>
        {compact ? null : <span className="relative min-w-0 flex-1 truncate text-left">{tab.label}</span>}
        {!compact && typeof count === 'number' && count > 0 ? (
          <span className={`relative rounded-md px-1.5 text-[11px] font-semibold tabular-nums ${active ? 'bg-white text-navy-700' : 'text-slate-400'}`}>
            {count > 9999 ? `${Math.floor(count / 1000)}k` : count.toLocaleString()}
          </span>
        ) : null}
        {pending ? (
          <span
            className={compact
              ? 'absolute right-1 top-1 min-w-[16px] rounded-full bg-navy-600 px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-white'
              : 'relative rounded-md bg-navy-600 px-1.5 text-[11px] font-semibold tabular-nums text-white'}
          >
            {selectedCVs.length}
          </span>
        ) : null}
      </button>
    );
  };

  const sections = (['Recruiting', 'Hiring', 'AI agents', 'Administration', 'Support'] as const)
    .map((name) => ({ name, items: navigationTabs.filter((t) => t.section === name) }))
    .filter((g) => g.items.length > 0);

  const sidebar = (scope: string, closable: boolean) => {
    const compact = collapsed && !closable;   // the phone drawer is always full
    return (
    <LayoutGroup id={scope}>
      <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-br from-navy-50 via-sky-50/60 to-white">
        <div className={`relative flex h-16 shrink-0 items-center ${compact ? 'justify-center px-2' : 'justify-between px-4'}`}>
          <button type="button" onClick={() => handleNavigate('dashboard')} className="flex min-w-0 items-center gap-2.5" aria-label="Alpha CV home" title="Alpha CV">
            <img src="/alphadatalogo.svg" alt="" className="h-8 w-8 shrink-0 rounded-lg object-contain" />
            {compact ? null : (
              <span className="truncate text-[17px] font-bold tracking-[-0.03em] text-slate-900">
                Alpha<span className="text-navy-600">CV</span>
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

        <nav className={`relative min-h-0 flex-1 overflow-y-auto pb-4 pt-1 ${compact ? 'space-y-3 px-2' : 'space-y-5 px-3'}`} aria-label="Main">
          {sections.map((group, gi) => (
            <div key={group.name} className="space-y-0.5">
              {compact ? (
                gi > 0 ? <div className="mx-3 mb-2 border-t border-surface-border" /> : null
              ) : (
                <div className="mb-1 px-3 text-[11px] font-semibold text-slate-400">{group.name}</div>
              )}
              {group.items.map((tab) => navButton(tab, scope, compact))}
            </div>
          ))}
        </nav>

        {user && (
          compact ? (
            <div className="relative m-2 flex shrink-0 flex-col items-center gap-1 rounded-xl border border-white/80 bg-white/70 p-2 shadow-sm backdrop-blur">
              <span title={`${user.username} (${roleLabel(user.role)})`}>
                <Avatar name={user.username} />
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white hover:text-red-600"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
          <div className="relative m-3 flex shrink-0 items-center gap-2.5 rounded-xl border border-white/80 bg-white/70 p-2.5 shadow-sm backdrop-blur">
            <Avatar name={user.username} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-slate-900">{user.username}</div>
              <div className="truncate text-xs text-slate-500">{roleLabel(user.role)}</div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white hover:text-red-600"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          )
        )}
      </div>
    </LayoutGroup>
    );
  };

  return (
    <div
      className={`relative isolate flex min-h-screen ${
        agentic
          ? 'bg-[var(--app-bg)]'
          : 'bg-gradient-to-br from-navy-50 via-sky-50/60 to-white'
      }`}
    >
      <aside
        className={`sticky top-0 z-20 hidden h-screen shrink-0 border-r border-white/70 transition-[width] duration-200 ease-out ${agentic ? '' : 'lg:block'}`}
        style={{ width: collapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH }}
      >
        {sidebar('desktop', false)}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="absolute -right-3 top-5 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-surface-border bg-white/90 text-slate-500 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-slate-900"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </aside>

      <AnimatePresence>
        {mobileNavOpen ? (
          <div key="mobile-nav" className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-slate-900/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: duration.base, ease }}
              onClick={() => setMobileNavOpen(false)}
              aria-hidden
            />
            <motion.aside
              className="absolute inset-y-0 left-0 w-[272px] border-r border-white/70 bg-gradient-to-br from-navy-50 via-sky-50/60 to-white shadow-panel"
              initial={{ x: -272 }}
              animate={{ x: 0 }}
              exit={{ x: -272, transition: { duration: duration.base, ease } }}
              transition={spring.soft}
            >
              {sidebar('mobile', true)}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>

      <main className={`relative flex min-w-0 flex-1 flex-col ${fullBleed ? 'h-dvh overflow-hidden' : ''}`}>
        {!agentic && (
          <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-white/70 bg-white/50 px-3 backdrop-blur lg:hidden">
            <button
              type="button"
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-900"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <img src="/alphadatalogo.svg" alt="" className="h-7 w-7 rounded-md object-contain" />
            <span className="text-[16px] font-bold tracking-[-0.03em] text-slate-900">Alpha<span className="text-navy-600">CV</span></span>
            <ModeToggle className="ml-auto" />
          </div>
        )}
        {!fullBleed && (
          <div className="hidden h-12 shrink-0 items-center justify-end px-4 lg:flex lg:px-8">
            <ModeToggle />
          </div>
        )}
        {fullBleed ? (
          <div className="min-h-0 flex-1">{children}</div>
        ) : (
          <div className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pt-7">{children}</div>
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
