import { api } from '@/lib/api';

/**
 * Admin: user management & destructive database tools.
 * Thin domain grouping over the existing `api` client — no new logic.
 */
export const adminService = {
  listUsers: api.listUsers,
  createUser: api.createUser,
  updateUser: api.updateUser,
  deleteUser: api.deleteUser,
  clearDatabase: api.clearDatabase,
};

export default adminService;
