/** Where people work. Recruiters, recruitment managers and sales managers belong to one location; the EVP and the admin see all of them. */
import type { Role } from '@/lib/roles';

export const LOCATIONS = ['Dubai', 'Abu Dhabi'] as const;

export function needsLocation(role?: Role | string | null): boolean {
  return role === 'user' || role === 'manager' || role === 'account_manager';
}
