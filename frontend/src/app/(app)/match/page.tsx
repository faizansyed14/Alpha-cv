'use client';

import dynamic from 'next/dynamic';
import { MatchSkeleton } from '@/components/skeletons';

const MatchingPage = dynamic(() => import('@/components/results/MatchingPage'), {
  loading: () => <MatchSkeleton />,
});

export default function MatchRoute() {
  return <MatchingPage />;
}
