/**
 * Workspace path map for authenticated ATS shell.
 * Replaces Zustand currentTab navigation while preserving match store state.
 */

export type WorkspaceId =
  | 'dashboard'
  | 'upload'
  | 'database'
  | 'candidates'
  | 'jobs'
  | 'match'
  | 'careers'
  | 'careers-manage'
  | 'email'
  | 'reports'
  | 'system'
  | 'performance'
  | 'tracker'
  | 'admin';

/** Canonical URL for each workspace. */
export const WORKSPACE_PATHS: Record<WorkspaceId, string> = {
  dashboard: '/dashboard',
  upload: '/upload',
  database: '/candidates', // default database view
  candidates: '/candidates',
  jobs: '/jobs',
  match: '/match',
  careers: '/careers-manage',
  'careers-manage': '/careers-manage',
  email: '/email',
  reports: '/reports',
  system: '/system',
  performance: '/performance',
  tracker: '/tracker',
  admin: '/admin/users',
};

const PATH_TO_WORKSPACE: Record<string, WorkspaceId> = {
  '/dashboard': 'dashboard',
  '/upload': 'upload',
  '/candidates': 'candidates',
  '/jobs': 'jobs',
  '/match': 'match',
  '/careers-manage': 'careers',
  '/email': 'email',
  '/reports': 'reports',
  '/system': 'system',
  '/performance': 'performance',
  '/tracker': 'tracker',
  '/admin/users': 'admin',
};

export function workspacePath(id: WorkspaceId | string): string {
  return WORKSPACE_PATHS[id as WorkspaceId] ?? '/dashboard';
}

export function workspaceFromPath(pathname: string): WorkspaceId | null {
  const clean = pathname.replace(/\/$/, '') || '/';
  return PATH_TO_WORKSPACE[clean] ?? null;
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
