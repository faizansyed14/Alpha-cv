'use client';

import dynamic from 'next/dynamic';
import { MonitorSkeleton } from '@/components/skeletons';

const MonitorPage = dynamic(() => import('@/components/monitor/MonitorPage'), {
  loading: () => <MonitorSkeleton />,
});

export default function MonitorRoute() {
  return <MonitorPage />;
}
