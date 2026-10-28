'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import AppShell from '@/components/layout/AppShell';
import Protected from '@/components/layout/Protected';
import ErrorBanner from '@/components/common/ErrorBanner';
import { LoadingPage } from '@/components/ui/loading';

const TRACKER_ONLY_ROLES = ['account_manager'];

export default function AuthenticatedAppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuthStore();
  const { systemHealth, loadSystemHealth, loadingStates } = useAppStore();

  const trackerOnly = !!user && TRACKER_ONLY_ROLES.includes(user.role as string);

  useEffect(() => {
    if (trackerOnly) router.replace('/tracker');
  }, [trackerOnly, router]);

  useEffect(() => {
    if (!systemHealth) loadSystemHealth();
  }, [systemHealth, loadSystemHealth]);

  if (trackerOnly) {
    return (
      <Protected>
        <LoadingPage title="Opening Tracker…" subtitle="Redirecting to your workspace" />
      </Protected>
    );
  }

  return (
    <Protected>
      <AppShell>
        <div className="space-y-4">
          <div className="space-y-2">
            {Object.entries(loadingStates).map(
              ([operation, state]) =>
                state.error && (
                  <ErrorBanner key={operation} error={state.error} operation={operation} />
                ),
            )}
          </div>
          {children}
        </div>
      </AppShell>
    </Protected>
  );
}
