'use client';

import dynamic from 'next/dynamic';
import { LoadingPage } from '@/components/ui/loading';

const SystemPanel = dynamic(() => import('@/components/system/SystemPanel'), {
  loading: () => <LoadingPage title="Loading..." subtitle="System" />,
});

export default function SystemRoute() {
  return <SystemPanel />;
}
