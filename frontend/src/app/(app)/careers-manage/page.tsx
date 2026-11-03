'use client';

import dynamic from 'next/dynamic';
import { CareersSkeleton } from '@/components/skeletons';

const CareersPage = dynamic(
  () => import('@/components/careers').then((m) => ({ default: m.CareersPage })),
  { loading: () => <CareersSkeleton /> },
);

export default function CareersManageRoute() {
  return <CareersPage />;
}
