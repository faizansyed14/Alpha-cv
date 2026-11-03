'use client';

import { Suspense } from 'react';
import PublicJobOpeningsPage from '@/components/careers/PublicJobOpeningsPage';
import { OpeningsSkeleton } from '@/components/skeletons';

export default function PublicJobOpeningsRoute() {
  return (
    <Suspense fallback={<OpeningsSkeleton />}>
      <PublicJobOpeningsPage />
    </Suspense>
  );
}

