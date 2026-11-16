'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { getToken } from '@/lib/auth';
import BusinessLanding from '@/components/marketing/BusinessLanding';
import { BootSkeleton } from '@/components/skeletons';
import { readPersistedWorkspacePath } from '@/lib/navigation';

/**
 * Public home: AlphaCV business page for guests.
 * Signed-in users continue into their workspace.
 *
 * The business page is what the server sends (and what a visitor who is not signed in sees at once). The workspace skeleton is shown only
 * to someone whose browser holds a sign-in token, while it is checked and they are taken to their workspace. Showing the skeleton to
 * everybody until the check finished put a dashboard placeholder on the public page.
 */
export default function HomePage() {
  const router = useRouter();
  const { user, loading, authHydrated } = useAuthStore();
  // Known only in the browser (the server cannot read it), so it is read after the page is first drawn: the first draw is always the business page.
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    setHasToken(!!getToken());
  }, []);

  useEffect(() => {
    if (!authHydrated || loading) return;
    if (!user) return;

    const last = readPersistedWorkspacePath();
    router.replace(last ?? '/dashboard');
  }, [router, user, loading, authHydrated]);

  if (user) {
    return <BootSkeleton />;
  }

  if (hasToken && (!authHydrated || loading)) {
    return <BootSkeleton />;
  }

  return <BusinessLanding />;
}
