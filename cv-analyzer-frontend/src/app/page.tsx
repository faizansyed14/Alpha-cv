'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import Protected from '@/components/layout/Protected';
import { LoadingPage } from '@/components/ui/loading';
import { readPersistedWorkspacePath } from '@/lib/navigation';

const TRACKER_ONLY_ROLES = ['account_manager'];

/**
 * Root `/` redirects into URL workspaces.
 * Preserves last workspace; tracker-only roles go to /tracker.
 */
export default function HomeRedirectPage() {
  const router = useRouter();
  const { user } = useAuthStore();

  useEffect(() => {
    if (user && TRACKER_ONLY_ROLES.includes(user.role as string)) {
      router.replace('/tracker');
      return;
    }
    const last = readPersistedWorkspacePath();
    router.replace(last ?? '/dashboard');
  }, [router, user]);

  return (
    <Protected>
      <LoadingPage title="Loading..." subtitle="Preparing your workspace" />
    </Protected>
  );
}
