'use client';

import Protected from '@/components/layout/Protected';
import AdminUsersPage from '@/features/admin/AdminUsersPage';

export default function AdminUsersRoutePage() {
  return (
    <Protected requireRole="admin">
      <AdminUsersPage />
    </Protected>
  );
}
