'use client';

import dynamic from 'next/dynamic';
import { ReportsSkeleton } from '@/components/skeletons';

const ReportGenerator = dynamic(() => import('@/components/reports/ReportGenerator'), {
  loading: () => <ReportsSkeleton />,
});

export default function ReportsRoute() {
  return <ReportGenerator />;
}
