'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { ProfessionalJobPage } from '@/components/careers';
import { JobDetailSkeleton } from '@/components/skeletons';

export default function PublicJobPageRoute() {
  const params = useParams();
  const token = params.token as string;

  return (
    <Suspense fallback={<JobDetailSkeleton />}>
      <ProfessionalJobPage token={token} />
    </Suspense>
  );
}