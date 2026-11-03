'use client';

import { ReactNode, useState, useEffect, type PointerEvent as ReactPointerEvent } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { duration, ease, spring } from '@/lib/motion';
import {
  LayoutDashboard,
  Upload,
  Target,
  Menu,
  X,
  Users,
  LogOut,
  FileText,
  Globe2,
  Activity,
  Mail,
  Shield,
  KanbanSquare,
} from '@/components/icons';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import MatchingLiveOverlay from '@/components/ui/MatchingLiveOverlay';
import NoticePopup from '@/components/common/NoticePopup';
import MatchTray from '@/components/layout/MatchTray';
import { Avatar } from '@/components/ui/avatar';
import {
  workspacePath,
  workspaceFromPath,
  isMatchPath,
  persistWorkspacePath,
  type WorkspaceId,
} from '@/lib/navigation';

interface AppShellProps {
  children: ReactNode;
}

interface TabItem {
  id: WorkspaceId | string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  section: 'Recruiting' | 'Hiring' | 'Administration';
}

const TRACKER_ONLY_ROLES = ['account_manager'];
const NAV_MIN = 208;
const NAV_MAX = 300;
const NAV_DEFAULT = 236;
const NAV_WIDTH_KEY = 'alphacv.navWidth';

const STAFF_ROLES = ['admin', 'user', 'recruiter', 'manager', 'evp'];

const getNavigationTabs = (
  userRole?: 'admin' | 'user' | 'recruiter' | 'manager' | 'evp' | 'account_manager',
): TabItem[] => {
  if (userRole && TRACKER_ONLY_ROLES.includes(userRole)) {
    return [{ id: 'tracker', label: 'Tracker', icon: KanbanSquare, description: 'Candidate tracker', section: 'Hiring' }];
  }

  const tabs: TabItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Overview and quick actions', section: 'Recruiting' },
    { id: 'candidates', label: 'Candidates', icon: Users, description: 'Browse and select CVs', section: 'Recruiting' },
    { id: 'jobs', label: 'Job descriptions', icon: FileText, description: 'Browse and select a JD', section: 'Recruiting' },
    { id: 'match', label: 'Match', icon: Target, description: 'AI matching results', section: 'Recruiting' },
    { id: 'upload', label: 'Upload', icon: Upload, description: 'Upload documents', section: 'Recruiting' },
  ];

  if (userRole) {
    tabs.push({ id: 'careers', label: 'Careers', icon: Globe2, description: 'Manage job postings', section: 'Hiring' });
  }
  if (userRole && STAFF_ROLES.includes(userRole)) {
    tabs.push({ id: 'tracker', label: 'Tracker', icon: KanbanSquare, description: 'Candidate tracker', section: 'Hiring' });
  }
  if (userRole === 'admin') {
    tabs.push({ id: 'admin', label: 'Users', icon: Shield, description: 'User management & database tools', section: 'Administration' });
    tabs.push({ id: 'monitor', label: 'Monitor', icon: Activity, description: 'Model calls, matching flow & system health', section: 'Administration' });
    tabs.push({ id: 'email', label: 'Email intake', icon: Mail, description: 'Email CV processing', section: 'Administration' });
  }
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
  const [navWidth, setNavWidth] = useState(NAV_DEFAULT);

  useEffect(() => {
    const saved = Number(localStorage.getItem(NAV_WIDTH_KEY));
    if (saved >= NAV_MIN && saved <= NAV_MAX) setNavWidth(saved);
  }, []);

  const onNavDragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = navWidth;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => {
      setNavWidth(Math.min(NAV_MAX, Math.max(NAV_MIN, startW + ev.clientX - startX)));
    };
    const up = (ev: PointerEvent) => {
      const next = Math.min(NAV_MAX, Math.max(NAV_MIN, startW + ev.clientX - startX));
      setNavWidth(next);
      localStorage.setItem(NAV_WIDTH_KEY, String(next));
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const currentWorkspace = workspaceFromPath(pathname) ?? 'dashboard';
  const navigationTabs = getNavigationTabs(user?.role);
  const navCounts: Record<string, number | undefined> = {
    candidates: totalCVs ?? (cvs.length || undefined),
    jobs: totalJDs ?? (jds.length || undefined),
  };

  useEffect(() => {
    persistWorkspacePath(pathname.replace(/\/$/, '') || '/dashboard');
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

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleNavigate = (tabId: string) => {
    setMobileNavOpen(false);
    router.push(workspacePath(tabId));
  };

  const navButton = (tab: TabItem, scope: string) => {
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
        title={tab.description}
        className={`group relative flex h-11 w-full items-center gap-3 rounded-xl border px-3 text-[13.5px] transition-colors duration-150 ${
          active ? 'border-navy-300 font-medium text-navy-700' : 'border-transparent font-normal text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        {active ? (
          <motion.span layoutId={`nav-pill-${scope}`} transition={spring.snappy} className="absolute inset-0 rounded-xl bg-navy-50/70" />
        ) : null}
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
          <Icon className="h-5 w-5" />
        </span>
        <span className="relative min-w-0 flex-1 truncate text-left">{tab.label}</span>
        {typeof count === 'number' && count > 0 ? (
          <span className={`relative rounded-md px-1.5 text-[11px] font-semibold tabular-nums ${active ? 'bg-white text-navy-700' : 'text-slate-400'}`}>
            {count > 9999 ? `${Math.floor(count / 1000)}k` : count.toLocaleString()}
          </span>
        ) : null}
        {pending ? (
          <span className="relative rounded-md bg-navy-600 px-1.5 text-[11px] font-semibold tabular-nums text-white">{selectedCVs.length}</span>
        ) : null}
      </button>
    );
  };

  const sections = (['Recruiting', 'Hiring', 'Administration'] as const)
    .map((name) => ({ name, items: navigationTabs.filter((t) => t.section === name) }))
    .filter((g) => g.items.length > 0);

  const sidebar = (scope: string, closable: boolean) => (
    <LayoutGroup id={scope}>
      <div className="flex h-full flex-col bg-white">
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <button type="button" onClick={() => handleNavigate('dashboard')} className="flex min-w-0 items-center gap-2.5" aria-label="Alpha CV home">
            <img src="/alphadatalogo.svg" alt="" className="h-8 w-8 shrink-0 rounded-lg object-contain" />
            <span className="truncate text-[17px] font-bold tracking-[-0.03em] text-slate-900">
              Alpha<span className="text-navy-600">CV</span>
            </span>
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

        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-1" aria-label="Main">
          {sections.map((group) => (
            <div key={group.name} className="space-y-0.5">
              <div className="mb-1 px-3 text-[11px] font-semibold text-slate-400">{group.name}</div>
              {group.items.map((tab) => navButton(tab, scope))}
            </div>
          ))}
        </nav>

        {user && (
          <div className="m-3 flex shrink-0 items-center gap-2.5 rounded-xl border border-surface-border bg-slate-50/70 p-2.5">
            <Avatar name={user.username} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-slate-900">{user.username}</div>
              <div className="truncate text-xs capitalize text-slate-500">{String(user.role).replace('_', ' ')}</div>
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
        )}
      </div>
    </LayoutGroup>
  );

  return (
    <div className="flex min-h-screen bg-[var(--app-bg)]">
      <aside
        className="sticky top-0 z-20 hidden h-screen shrink-0 border-r border-surface-border lg:block"
        style={{ width: navWidth }}
      >
        {sidebar('desktop', false)}
        <button
          type="button"
          aria-label="Drag to resize navigation"
          title="Drag to give the page more room"
          onPointerDown={onNavDragStart}
          onDoubleClick={() => {
            setNavWidth(NAV_DEFAULT);
            localStorage.setItem(NAV_WIDTH_KEY, String(NAV_DEFAULT));
          }}
          className="absolute -right-1 top-0 z-30 h-full w-2 cursor-col-resize bg-transparent transition-colors hover:bg-navy-200/60"
        />
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
              className="absolute inset-y-0 left-0 w-[272px] border-r border-surface-border shadow-panel"
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

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="glass sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-surface-border px-3 lg:hidden">
          <button
            type="button"
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <img src="/alphadatalogo.svg" alt="" className="h-7 w-7 rounded-md object-contain" />
          <span className="text-[16px] font-bold tracking-[-0.03em] text-slate-900">Alpha<span className="text-navy-600">CV</span></span>
        </div>
        <div className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pt-7">{children}</div>
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
