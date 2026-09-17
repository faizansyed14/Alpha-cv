'use client';

import { ReactNode, useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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

interface AppLayoutProps {
  children: ReactNode;
}

interface TabItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  badge?: string;
  /** Optional sub-items (e.g. Database → Candidates / Jobs). */
  children?: { id: string; label: string }[];
}

/** Roles whose only workspace is the Candidate Tracker. */
const TRACKER_ONLY_ROLES = ['account_manager'];

const getNavigationTabs = (userRole?: 'admin' | 'user' | 'recruiter' | 'manager' | 'evp' | 'account_manager'): TabItem[] => {
  // Tracker-only roles (e.g. account_manager) see ONLY the Tracker entry.
  if (userRole && TRACKER_ONLY_ROLES.includes(userRole)) {
    return [
      {
        id: 'tracker',
        label: 'Tracker',
        icon: Users,
        description: 'Candidate tracker',
      },
    ];
  }

  const baseTabs: TabItem[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: Home,
      description: 'Overview and quick actions',
    },
    {
      id: 'upload',
      label: 'Upload',
      icon: Upload,
      description: 'Upload documents',
    },
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
    {
      id: 'match',
      label: 'Match',
      icon: Target,
      description: 'AI matching results',
    },
  ];

  // Add careers tab for all authenticated users (HR and admin)
  if (userRole) {
    baseTabs.push({
      id: 'careers',
      label: 'Careers',
      icon: Briefcase,
      description: 'Manage job postings',
    });
  }

  // Candidate Tracker entry (server-side feature flag still enforced by API).
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

/** Admin-only section */
const getAdvancedTabs = (userRole?: 'admin' | 'user' | 'recruiter' | 'manager' | 'evp' | 'account_manager'): TabItem[] => {
  if (userRole === 'admin') {
    return [
      { id: 'admin', label: 'Admin', icon: Shield, description: 'User management & database tools' },
      { id: 'performance', label: 'Performance', icon: Activity, description: 'System monitoring & metrics' },
      { id: 'email', label: 'Email', icon: Mail, description: 'Email CV processing' },
    ];
  }
  return [];
};

/** Titles for tabs that are reachable but not in the nav */
const EXTRA_TAB_TITLES: Record<string, string> = {
  reports: 'Reports',
  system: 'System',
  candidates: 'Candidates',
  jobs: 'Job descriptions',
};

function getInitials(name?: string) {
  if (!name) return '?';
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function AppLayoutNew({ children }: AppLayoutProps) {
  const router = useRouter();
  const { currentTab, setCurrentTab, matchingProgress } = useAppStore();
  const { user, logout } = useAuthStore();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [dbOpen, setDbOpen] = useState(true);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const navigationTabs = getNavigationTabs(user?.role);
  const advancedTabs = getAdvancedTabs(user?.role);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Presence heartbeat: keep the user marked "online" on the admin page even
  // while sitting idle on a static screen. `me` is a cheap authed call.
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const beat = () => { api.me(token).catch(() => {}); };
    const id = setInterval(beat, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [user?.username]);

  // Close the mobile drawer with Escape
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

  /** Single navigation entry-point; preserves tracker + admin routing behavior. */
  const handleNavigate = (tabId: string) => {
    setMobileNavOpen(false);
    if (tabId === 'tracker') {
      router.push('/tracker');
      return;
    }
    if (tabId === 'admin') {
      router.push('/admin/users');
      return;
    }
    setCurrentTab(tabId as any);
  };

  const allTabs = [...navigationTabs, ...advancedTabs];
  const pageTitle =
    allTabs.find((t) => t.id === currentTab)?.label ?? EXTRA_TAB_TITLES[currentTab] ?? 'Dashboard';

  const NavItem = ({
    tab,
    compact,
  }: {
    tab: TabItem;
    /** icon-only rendering (md..lg collapsed sidebar) */
    compact?: boolean;
  }) => {
    const Icon = tab.icon;

    // Grouped entry (e.g. Database → Candidates / Job descriptions).
    if (tab.children && tab.children.length > 0) {
      const groupActive = tab.children.some((c) => c.id === currentTab) || currentTab === tab.id;
      return (
        <div onMouseEnter={() => setDbOpen(true)}>
          <button
            onClick={() => { setDbOpen((v) => !v); handleNavigate(tab.children![0].id); }}
            title={tab.label}
            className={`relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${
              compact ? 'justify-center lg:justify-start' : ''
            } ${groupActive ? 'bg-brand-50 text-brand-600' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
          >
            {groupActive && (
              <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand-600" />
            )}
            <Icon className={`h-4 w-4 shrink-0 ${groupActive ? 'text-brand-600' : 'text-gray-400'}`} />
            <span className={compact ? 'hidden lg:inline truncate' : 'truncate'}>{tab.label}</span>
            <ChevronDown
              className={`ml-auto h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${dbOpen ? 'rotate-180' : ''} ${compact ? 'hidden lg:block' : ''}`}
            />
          </button>
          {dbOpen && (
            <div className={`mt-0.5 space-y-0.5 ${compact ? 'hidden lg:block' : ''}`}>
              {tab.children.map((child) => {
                const childActive = currentTab === child.id;
                return (
                  <button
                    key={child.id}
                    onClick={() => handleNavigate(child.id)}
                    aria-current={childActive ? 'page' : undefined}
                    className={`flex w-full items-center gap-2 rounded-md py-1.5 pl-9 pr-2.5 text-left text-[13px] transition-colors ${
                      childActive ? 'bg-brand-50 font-medium text-brand-600' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${childActive ? 'bg-brand-600' : 'bg-gray-300'}`} />
                    <span className="truncate">{child.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    const isActive = currentTab === tab.id;
    return (
      <button
        key={tab.id}
        onClick={() => handleNavigate(tab.id)}
        title={tab.label}
        aria-current={isActive ? 'page' : undefined}
        className={`relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${
          compact ? 'justify-center lg:justify-start' : ''
        } ${
          isActive
            ? 'bg-brand-50 text-brand-600'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
      >
        {/* Active left indicator */}
        {isActive && (
          <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand-600" />
        )}
        <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-brand-600' : 'text-gray-400'}`} />
        <span className={compact ? 'hidden lg:inline truncate' : 'truncate'}>{tab.label}</span>
      </button>
    );
  };

  const SidebarSections = ({ compact }: { compact?: boolean }) => (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      <div>
        <div
          className={`mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 ${
            compact ? 'hidden lg:block' : ''
          }`}
        >
          Main
        </div>
        <div className="space-y-0.5">
          {navigationTabs.map((tab) => (
            <NavItem key={tab.id} tab={tab} compact={compact} />
          ))}
        </div>
      </div>
      {advancedTabs.length > 0 && (
        <div>
          <div
            className={`mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 ${
              compact ? 'hidden lg:block' : ''
            }`}
          >
            Admin
          </div>
          <div className="space-y-0.5">
            {advancedTabs.map((tab) => (
              <NavItem key={tab.id} tab={tab} compact={compact} />
            ))}
          </div>
        </div>
      )}
    </nav>
  );

  const LogoArea = ({ compact }: { compact?: boolean }) => (
    <div
      className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-gray-200 px-4 ${
        compact ? 'justify-center lg:justify-start' : ''
      }`}
    >
      <img src="/alphadatalogo.svg" alt="Alpha Data Logo" className="h-7 w-7 shrink-0 object-contain" />
      <div className={`text-[15px] font-semibold text-gray-900 ${compact ? 'hidden lg:block' : ''}`}>
        Alpha <span className="text-brand-600">CV</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      {/* Desktop / tablet sidebar: icon-only below lg (1024px), full at lg+; hidden below md (768px) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-16 flex-col border-r border-gray-200 bg-white md:flex lg:w-60">
        <LogoArea compact />
        <SidebarSections compact />
      </aside>

      {/* Mobile slide-over drawer (<768px) */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-gray-950/40"
            aria-hidden
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-60 flex-col border-r border-gray-200 bg-white shadow-xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 pr-2">
              <LogoArea />
              <button
                onClick={() => setMobileNavOpen(false)}
                className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <SidebarSections />
            {user && (
              <div className="shrink-0 border-t border-gray-200 p-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">
                    {getInitials(user.username)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-gray-900">{user.username}</div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">{user.role}</div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
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

      {/* Main column */}
      <div className="flex min-h-screen flex-col md:pl-16 lg:pl-60">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 md:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="truncate text-lg font-semibold tracking-tight text-gray-900">{pageTitle}</h1>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <span className="hidden text-[13px] text-gray-600 sm:block">
                Welcome, <span className="font-semibold text-gray-900">{user.username}</span>
              </span>
            )}
            <HealthBadge />
            {user && (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-gray-50"
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">
                    {getInitials(user.username)}
                  </div>
                  <span className="hidden max-w-[140px] truncate text-[13px] font-medium text-gray-700 sm:block">
                    {user.username}
                  </span>
                  <ChevronDown
                    className={`hidden h-3.5 w-3.5 text-gray-400 transition-transform sm:block ${
                      userMenuOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg shadow-gray-900/5">
                    <div className="border-b border-gray-100 px-3.5 py-2.5">
                      <div className="truncate text-[13px] font-medium text-gray-900">{user.username}</div>
                      <span className="mt-1 inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        {user.role}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        handleLogout();
                      }}
                      className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    >
                      <LogOut className="h-4 w-4 text-gray-400" />
                      Logout
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 bg-[#F7F8FA] p-6">{children}</main>
      </div>

      {/* Admin-published notice popup (non-admin users) */}
      <NoticePopup />

      {/* Corner matching indicator: shown on every OTHER tab so switching away from
          Match doesn't lose visibility that a job is still running. The Match tab
          itself shows the full immersive animation instead (MatchingFullPageAnimation),
          so it's suppressed there to avoid showing both at once. */}
      <MatchingLiveOverlay
        totalCVs={matchingProgress.totalCVs}
        processedCVs={matchingProgress.processedCVs}
        currentStage={matchingProgress.currentStage}
        estimatedTimeRemaining={matchingProgress.estimatedTimeRemaining}
        isVisible={matchingProgress.isVisible && currentTab !== 'match'}
        currentBatch={matchingProgress.currentBatch}
        totalBatches={matchingProgress.totalBatches}
        phase={matchingProgress.phase}
        currentCandidate={matchingProgress.currentCandidate}
        recentCandidates={matchingProgress.recentCandidates}
      />
    </div>
  );
}
