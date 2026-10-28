'use client';

import { ReactNode, useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Home,
  Upload,
  Database,
  Target,
  Menu,
  X,
  ChevronDown,
  Users,
  LogOut,
  Briefcase,
  Activity,
  Mail,
  Shield,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import MatchingLiveOverlay from '@/components/ui/MatchingLiveOverlay';
import HealthBadge from '@/components/common/HealthBadge';
import NoticePopup from '@/components/common/NoticePopup';
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
  children?: { id: WorkspaceId | string; label: string }[];
}

const TRACKER_ONLY_ROLES = ['account_manager'];

const getNavigationTabs = (
  userRole?: 'admin' | 'user' | 'recruiter' | 'manager' | 'evp' | 'account_manager',
): TabItem[] => {
  if (userRole && TRACKER_ONLY_ROLES.includes(userRole)) {
    return [{ id: 'tracker', label: 'Tracker', icon: Users, description: 'Candidate tracker' }];
  }

  const baseTabs: TabItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: Home, description: 'Overview and quick actions' },
    { id: 'upload', label: 'Upload', icon: Upload, description: 'Upload documents' },
    {
      id: 'database',
      label: 'Database',
      icon: Database,
      description: 'Manage documents',
      children: [
        { id: 'candidates', label: 'Candidates' },
        { id: 'jobs', label: 'Job descriptions' },
      ],
    },
    { id: 'match', label: 'Match', icon: Target, description: 'AI matching results' },
  ];

  if (userRole) {
    baseTabs.push({
      id: 'careers',
      label: 'Careers',
      icon: Briefcase,
      description: 'Manage job postings',
    });
  }

  if (userRole && ['admin', 'user', 'recruiter', 'manager', 'evp'].includes(userRole)) {
    baseTabs.push({
      id: 'tracker',
      label: 'Tracker',
      icon: Users,
      description: 'Candidate tracker',
    });
  }

  return baseTabs;
};

const getAdvancedTabs = (
  userRole?: 'admin' | 'user' | 'recruiter' | 'manager' | 'evp' | 'account_manager',
): TabItem[] => {
  if (userRole === 'admin') {
    return [
      { id: 'admin', label: 'Admin', icon: Shield, description: 'User management & database tools' },
      { id: 'performance', label: 'Performance', icon: Activity, description: 'System monitoring & metrics' },
      { id: 'email', label: 'Email', icon: Mail, description: 'Email CV processing' },
    ];
  }
  return [];
};

function getInitials(name?: string) {
  if (!name) return '?';
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { matchingProgress, loadCVs, loadJDs, loadSystemHealth, loadSystemStats, loadDatabaseView, cvs, systemHealth } =
    useAppStore();
  const { user, logout } = useAuthStore();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [dbMenuOpen, setDbMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const dbMenuRef = useRef<HTMLDivElement>(null);

  const currentWorkspace = workspaceFromPath(pathname) ?? 'dashboard';
  const navigationTabs = getNavigationTabs(user?.role);
  const advancedTabs = getAdvancedTabs(user?.role);
  const allTabs = [...navigationTabs, ...advancedTabs];

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
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) setUserMenuOpen(false);
      if (dbMenuRef.current && !dbMenuRef.current.contains(target)) setDbMenuOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

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
    setDbMenuOpen(false);
    setUserMenuOpen(false);
    router.push(workspacePath(tabId));
  };

  const renderTopNavTab = (tab: TabItem) => {
    const Icon = tab.icon;

    if (tab.children && tab.children.length > 0) {
      const groupActive =
        tab.children.some((c) => c.id === currentWorkspace) || currentWorkspace === tab.id;
      return (
        <div key={tab.id} className="relative" ref={dbMenuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setUserMenuOpen(false);
              setDbMenuOpen((v) => !v);
            }}
            aria-haspopup="menu"
            aria-expanded={dbMenuOpen}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
              groupActive
                ? 'bg-navy-50 text-navy-800'
                : 'text-slate-600 hover:bg-slate-50 hover:text-navy-800'
            }`}
          >
            <Icon className={`h-4 w-4 ${groupActive ? 'text-navy-500' : 'text-slate-400'}`} />
            <span>{tab.label}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-slate-400 transition-transform ${dbMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {dbMenuOpen ? (
            <div
              role="menu"
              className="absolute left-0 top-full z-[60] mt-1.5 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-[var(--shadow-md)]"
            >
              {tab.children.map((child) => {
                const childActive = currentWorkspace === child.id;
                return (
                  <button
                    key={child.id}
                    type="button"
                    role="menuitem"
                    onClick={() => handleNavigate(child.id)}
                    aria-current={childActive ? 'page' : undefined}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] transition-colors ${
                      childActive
                        ? 'bg-navy-50 font-medium text-navy-800'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-navy-800'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${childActive ? 'bg-navy-500' : 'bg-slate-300'}`}
                    />
                    {child.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      );
    }

    const isActive = currentWorkspace === tab.id;
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => handleNavigate(tab.id)}
        title={tab.description}
        aria-current={isActive ? 'page' : undefined}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
          isActive
            ? 'bg-navy-50 text-navy-800'
            : 'text-slate-600 hover:bg-slate-50 hover:text-navy-800'
        }`}
      >
        <Icon className={`h-4 w-4 ${isActive ? 'text-navy-500' : 'text-slate-400'}`} />
        <span>{tab.label}</span>
      </button>
    );
  };

  const MobileNavSections = () => (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      <div>
        <div className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Main
        </div>
        <div className="space-y-0.5">
          {navigationTabs.map((tab) => {
            const Icon = tab.icon;
            if (tab.children?.length) {
              return (
                <div key={tab.id} className="space-y-0.5">
                  <div className="flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-medium text-slate-500">
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </div>
                  {tab.children.map((child) => {
                    const childActive = currentWorkspace === child.id;
                    return (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => handleNavigate(child.id)}
                        className={`flex w-full items-center gap-2 rounded-md py-1.5 pl-9 pr-2.5 text-left text-[13px] ${
                          childActive
                            ? 'bg-navy-50 font-medium text-navy-800'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {child.label}
                      </button>
                    );
                  })}
                </div>
              );
            }
            const isActive = currentWorkspace === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleNavigate(tab.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium ${
                  isActive ? 'bg-navy-50 text-navy-800' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      {advancedTabs.length > 0 && (
        <div>
          <div className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Admin
          </div>
          <div className="space-y-0.5">
            {advancedTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentWorkspace === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleNavigate(tab.id)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium ${
                    isActive ? 'bg-navy-50 text-navy-800' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[var(--app-bg)]">
      <header className="sticky top-0 z-40 border-b border-surface-border bg-paper/95 backdrop-blur-sm">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
          <button
            type="button"
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 lg:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('dashboard')}
            className="flex shrink-0 items-center gap-2.5"
            aria-label="Alpha CV home"
          >
            <img src="/alphadatalogo.svg" alt="" className="h-7 w-7 object-contain" />
            <span className="hidden text-[15px] font-semibold text-navy-800 sm:inline">
              Alpha <span className="text-navy-500">CV</span>
            </span>
          </button>

          <nav
            className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-visible lg:flex"
            aria-label="Main"
          >
            {allTabs.map((tab) => renderTopNavTab(tab))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            <HealthBadge />
            {user && (
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50"
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-800 text-[11px] font-semibold text-paper">
                    {getInitials(user.username)}
                  </div>
                  <span className="hidden max-w-[120px] truncate text-[13px] font-medium text-slate-700 md:block">
                    {user.username}
                  </span>
                  <ChevronDown
                    className={`hidden h-3.5 w-3.5 text-slate-400 transition-transform md:block ${
                      userMenuOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-[var(--shadow-md)] animate-page-enter">
                    <div className="border-b border-slate-100 px-3.5 py-2.5">
                      <div className="truncate text-[13px] font-medium text-slate-900">{user.username}</div>
                      <span className="mt-1 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {user.role}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        handleLogout();
                      }}
                      className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    >
                      <LogOut className="h-4 w-4 text-slate-400" />
                      Logout
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-950/40"
            aria-hidden
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-60 flex-col border-r border-slate-200 bg-white shadow-[var(--shadow-lg)] animate-page-enter">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
              <div className="flex items-center gap-2.5">
                <img src="/alphadatalogo.svg" alt="" className="h-7 w-7 object-contain" />
                <span className="text-[15px] font-semibold text-navy-800">
                  Alpha <span className="text-navy-500">CV</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <MobileNavSections />
            {user && (
              <div className="shrink-0 border-t border-slate-200 p-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-800 text-[11px] font-semibold text-paper">
                    {getInitials(user.username)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-slate-900">{user.username}</div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">{user.role}</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="Logout"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      <main className="flex-1 bg-[var(--app-bg)] p-4 sm:p-6">
        <div className="animate-page-enter">{children}</div>
      </main>

      <NoticePopup />

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
      />
    </div>
  );
}
