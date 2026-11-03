'use client';

import { Suspense } from 'react';
import { ProfessionalJobPage } from '@/components/careers';
import { JobDetailSkeleton } from '@/components/skeletons';

function CareersPageContent() {
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const token = searchParams.get('token') || '';

  return <ProfessionalJobPage token={token} />;
}

export default function PublicCareersPage() {
  return (
    <Suspense fallback={<JobDetailSkeleton />}>
      <CareersPageContent />
    </Suspense>
  );
}
