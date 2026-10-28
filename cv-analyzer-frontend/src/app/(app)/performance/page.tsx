'use client';

import dynamic from 'next/dynamic';
import { LoadingPage } from '@/components/ui/loading';

const PerformancePage = dynamic(() => import('@/components/performance/PerformancePage'), {
  loading: () => <LoadingPage title="Loading..." subtitle="Performance" />,
});

export default function PerformanceRoute() {
  return <PerformancePage />;
}
