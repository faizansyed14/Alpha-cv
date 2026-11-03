'use client';

import dynamic from 'next/dynamic';
import { JobsSkeleton } from '@/components/skeletons';

const DatabasePage = dynamic(() => import('@/components/database/DatabasePage'), {
  loading: () => <JobsSkeleton />,
});

export default function JobsRoute() {
  return <DatabasePage lockedView="jobs" />;
}
