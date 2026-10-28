'use client';

import dynamic from 'next/dynamic';
import { LoadingPage } from '@/components/ui/loading';

const DashboardPage = dynamic(() => import('@/components/dashboard/DashboardPage'), {
  loading: () => <LoadingPage title="Loading..." subtitle="Dashboard" />,
});

export default function DashboardRoute() {
  return <DashboardPage />;
}
