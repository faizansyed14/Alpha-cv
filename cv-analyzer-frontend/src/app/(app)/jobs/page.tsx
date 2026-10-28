'use client';

import dynamic from 'next/dynamic';
import { LoadingPage } from '@/components/ui/loading';

const DatabasePage = dynamic(() => import('@/components/database/DatabasePage'), {
  loading: () => <LoadingPage title="Loading..." subtitle="Jobs" />,
});

export default function JobsRoute() {
  return <DatabasePage lockedView="jobs" />;
}
