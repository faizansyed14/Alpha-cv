'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import BusinessLanding from '@/components/marketing/BusinessLanding';
import { BootSkeleton } from '@/components/skeletons';
import { readPersistedWorkspacePath } from '@/lib/navigation';

/**
 * Public home: AlphaCV business page for guests.
 * Signed-in users continue into their workspace.
 */
export default function HomePage() {
  const router = useRouter();
  const { user, loading, authHydrated } = useAuthStore();

  useEffect(() => {
    if (!authHydrated || loading) return;
    if (!user) return;

    const last = readPersistedWorkspacePath();
    router.replace(last ?? '/dashboard');
  }, [router, user, loading, authHydrated]);

  if (!authHydrated || loading) {
    return <BootSkeleton />;
  }

  if (user) {
    return <BootSkeleton />;
  }

  return <BusinessLanding />;
}
