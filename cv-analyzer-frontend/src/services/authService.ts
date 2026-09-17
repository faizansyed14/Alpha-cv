import { api } from '@/lib/api';

/**
 * Authentication & session — thin domain grouping over the existing `api` client.
 * No new logic: every member is a direct reference to an `api` method.
 */
export const authService = {
  login: api.login,
  me: api.me,
  verifyPassword: api.verifyPassword,
  sendOTP: api.sendOTP,
  verifyOTP: api.verifyOTP,
};

export default authService;
