'use client';

import dynamic from 'next/dynamic';
import { CandidatesSkeleton } from '@/components/skeletons';

const DatabasePage = dynamic(() => import('@/components/database/DatabasePage'), {
  loading: () => <CandidatesSkeleton />,
});

export default function CandidatesRoute() {
  return <DatabasePage lockedView="candidates" />;
}
