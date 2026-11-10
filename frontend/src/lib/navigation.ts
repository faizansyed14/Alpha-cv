/**
 * Workspace path map for authenticated ATS shell.
 * Replaces Zustand currentTab navigation while preserving match store state.
 */

export type WorkspaceId =
  | 'dashboard'
  | 'upload'
  | 'database'
  | 'candidates'
  | 'saved'
  | 'jobs'
  | 'match'
  | 'careers'
  | 'careers-manage'
  | 'reports'
  | 'system'
  | 'monitor'
  | 'agent-interview'
  | 'agent-linkedin'
  | 'agent-usage'
  | 'tracker'
  | 'report-bug'
  | 'admin-bugs'
  | 'admin';

/** Canonical URL for each workspace. */
export const WORKSPACE_PATHS: Record<WorkspaceId, string> = {
  dashboard: '/dashboard',
  upload: '/upload',
  database: '/candidates', // default database view
  candidates: '/candidates',
  saved: '/saved-cvs',
  jobs: '/jobs',
  match: '/match',
  careers: '/careers-manage',
  'careers-manage': '/careers-manage',
  reports: '/reports',
  system: '/system',
  monitor: '/monitor',
  'agent-interview': '/agents/interview',
  'agent-linkedin': '/agents/linkedin',
  'agent-usage': '/agents/usage',
  tracker: '/tracker',
  'report-bug': '/report-bug',
  'admin-bugs': '/admin/bugs',
  admin: '/admin/users',
};

const PATH_TO_WORKSPACE: Record<string, WorkspaceId> = {
  '/dashboard': 'dashboard',
  '/upload': 'upload',
  '/candidates': 'candidates',
  '/saved-cvs': 'saved',
  '/jobs': 'jobs',
  '/match': 'match',
  '/careers-manage': 'careers',
  '/reports': 'reports',
  '/system': 'system',
  '/monitor': 'monitor',
  '/agents/interview': 'agent-interview',
  '/agents/linkedin': 'agent-linkedin',
  '/agents/usage': 'agent-usage',
  '/tracker': 'tracker',
  '/report-bug': 'report-bug',
  '/admin/bugs': 'admin-bugs',
  '/admin/users': 'admin',
};

export function workspacePath(id: WorkspaceId | string): string {
  return WORKSPACE_PATHS[id as WorkspaceId] ?? '/dashboard';
}

export function workspaceFromPath(pathname: string): WorkspaceId | null {
  const clean = pathname.replace(/\/$/, '') || '/';
  if (clean.startsWith('/candidates/')) return 'candidates';
  return PATH_TO_WORKSPACE[clean] ?? null;
}

/** Pages that fill the whole window (no page padding or width limit): the AI agent chats. */
export function isFullBleedPath(pathname: string): boolean {
  const p = pathname.replace(/\/$/, '');
  return p === '/agents/interview' || p === '/agents/linkedin' || p === '/agentic';
}

export function isMatchPath(pathname: string): boolean {
  return pathname.replace(/\/$/, '') === '/match';
}

const LAST_WORKSPACE_KEY = 'alpha_cv_last_workspace_path';

export function persistWorkspacePath(path: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, path);
  } catch {
    /* ignore */
  }
}

export function readPersistedWorkspacePath(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_WORKSPACE_KEY);
    if (raw && Object.values(WORKSPACE_PATHS).includes(raw)) return raw;
    // Migrate legacy tab key
    const legacy = localStorage.getItem('alpha_cv_current_tab');
    if (legacy && WORKSPACE_PATHS[legacy as WorkspaceId]) {
      return WORKSPACE_PATHS[legacy as WorkspaceId];
    }
  } catch {
    /* ignore */
  }
  return null;
}
