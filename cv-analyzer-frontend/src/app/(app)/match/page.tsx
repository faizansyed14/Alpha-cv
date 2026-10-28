'use client';

import dynamic from 'next/dynamic';
import { LoadingPage } from '@/components/ui/loading';

const MatchingPage = dynamic(() => import('@/components/results/MatchingPage'), {
  loading: () => <LoadingPage title="Loading..." subtitle="Matching" />,
});

export default function MatchRoute() {
  return <MatchingPage />;
}
