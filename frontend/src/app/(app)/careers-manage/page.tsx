'use client';

import dynamic from 'next/dynamic';
import { CareersListSkeleton } from '@/components/careers/CareersRouteSkeleton';

const CareersPage = dynamic(
  () => import('@/components/careers').then((m) => ({ default: m.CareersPage })),
  { loading: () => <CareersListSkeleton /> },
);

export default function CareersManageRoute() {
  return <CareersPage />;
}
