'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAppStore } from '@/stores/appStore';
import AppShell from '@/components/layout/AppShell';
import Protected from '@/components/layout/Protected';
import ErrorBanner from '@/components/common/ErrorBanner';
import { isFullBleedPath } from '@/lib/navigation';

export default function AuthenticatedAppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { systemHealth, loadSystemHealth, loadingStates } = useAppStore();

  useEffect(() => {
    if (!systemHealth) loadSystemHealth();
  }, [systemHealth, loadSystemHealth]);

  if (isFullBleedPath(pathname)) {
    return (
      <Protected>
        <AppShell>{children}</AppShell>
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
