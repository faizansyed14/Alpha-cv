'use client';

import dynamic from 'next/dynamic';
import { LoadingPage } from '@/components/ui/loading';

const ReportGenerator = dynamic(() => import('@/components/reports/ReportGenerator'), {
  loading: () => <LoadingPage title="Loading..." subtitle="Reports" />,
});

export default function ReportsRoute() {
  return <ReportGenerator />;
}
