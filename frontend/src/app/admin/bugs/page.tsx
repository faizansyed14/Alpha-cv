'use client';

import Protected from '@/components/layout/Protected';
import AppShell from '@/components/layout/AppShell';
import AdminBugsPage from '@/features/bugs/AdminBugsPage';

export default function AdminBugsRoutePage() {
  return (
    <Protected requireRole="admin">
      <AppShell>
        <AdminBugsPage />
      </AppShell>
    </Protected>
  );
}
