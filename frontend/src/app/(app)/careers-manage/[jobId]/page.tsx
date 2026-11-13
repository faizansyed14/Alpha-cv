'use client';

import dynamic from 'next/dynamic';
import { CareersJobSkeleton } from '@/components/careers/CareersRouteSkeleton';

const JobDetailPage = dynamic(
  () => import('@/components/careers/JobDetailPage'),
  { loading: () => <CareersJobSkeleton /> },
);

export default function CareersJobDetailRoute() {
  return <JobDetailPage />;
}
