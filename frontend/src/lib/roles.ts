/**
 * The roles of the application. There are two levels of access: `admin` (also manages users, the AI agents' usage, monitoring and bug
 * reports) and everyone else. Recruiter, recruitment manager, EVP and sales manager are labels of what a person does: they all
 * have the same access.
 */
export type Role = 'admin' | 'user' | 'manager' | 'evp' | 'account_manager';

export const STAFF_ROLES: Exclude<Role, 'admin'>[] = ['user', 'manager', 'evp', 'account_manager'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  user: 'Recruiter',
  manager: 'Recruitment manager',
  evp: 'EVP',
  account_manager: 'Sales manager',
};

export function roleLabel(role?: string | null): string {
  return (role && ROLE_LABELS[role as Role]) || String(role ?? '').replace('_', ' ');
}
