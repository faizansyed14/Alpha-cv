'use client';

import Protected from '@/components/layout/Protected';
import AppShell from '@/components/layout/AppShell';
import AdminUsersPage from '@/features/admin/AdminUsersPage';

export default function AdminUsersRoutePage() {
  return (
    <Protected requireRole="admin">
      <AppShell>
        <AdminUsersPage />
      </AppShell>
    </Protected>
  );
}
