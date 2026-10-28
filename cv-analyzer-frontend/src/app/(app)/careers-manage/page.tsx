'use client';

import dynamic from 'next/dynamic';
import { LoadingPage } from '@/components/ui/loading';

const CareersPage = dynamic(
  () => import('@/components/careers').then((m) => ({ default: m.CareersPage })),
  { loading: () => <LoadingPage title="Loading..." subtitle="Careers" /> },
);

export default function CareersManageRoute() {
  return <CareersPage />;
}
