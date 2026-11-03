'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LoginForm from '@/components/auth/LoginForm';
import { useAuthStore } from '@/stores/authStore';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { LoginSkeleton } from '@/components/skeletons';

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuthStore();
  const [initTimeout, setInitTimeout] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setInitTimeout(true), 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (user && !loading) {
      const from = safeRedirectPath(searchParams.get('from'));
      router.replace(from ?? '/dashboard');
    }
  }, [user, loading, router, searchParams]);

  if (user && !loading) {
    return null;
  }

  if (!loading || initTimeout) {
    return <LoginForm />;
  }

  return (
    <LoginSkeleton />
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <LoginSkeleton />
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
