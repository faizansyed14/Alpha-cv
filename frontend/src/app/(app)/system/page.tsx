'use client';

import dynamic from 'next/dynamic';
import { SystemSkeleton } from '@/components/skeletons';

const SystemPanel = dynamic(() => import('@/components/system/SystemPanel'), {
  loading: () => <SystemSkeleton />,
});

export default function SystemRoute() {
  return <SystemPanel />;
}
