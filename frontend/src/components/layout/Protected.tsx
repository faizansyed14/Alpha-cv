'use client';
import type { Role } from '@/lib/roles';

import { useEffect, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { BootSkeleton } from '@/components/skeletons';

interface ProtectedProps {
  children: ReactNode;
  requireRole?: Role;
  fallbackPath?: string;
}

export default function Protected({ 
  children, 
  requireRole,
  fallbackPath = '/login' 
}: ProtectedProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, authHydrated } = useAuthStore();

  useEffect(() => {
    if (!authHydrated || loading) return;

    if (!user) {
      const here = pathname && pathname !== '/login' ? `${pathname}${typeof window !== 'undefined' ? window.location.search : ''}` : '';
      const q = here ? `?from=${encodeURIComponent(here)}` : '';
      router.push(`${fallbackPath}${q}`);
      return;
    }

    if (requireRole && user.role !== requireRole) {
      router.push('/dashboard');
    }
  }, [user, loading, authHydrated, requireRole, router, fallbackPath, pathname]);

  if (!authHydrated || loading) {
    return <BootSkeleton />;
  }

  if (!user || (requireRole && user.role !== requireRole)) {
    return null;
  }

  return <>{children}</>;
}
