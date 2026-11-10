'use client';

import { Suspense, use } from 'react';
import CandidateProfilePage from '@/components/database/CandidateProfilePage';

export default function CandidateProfileRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <CandidateProfilePage cvId={id} />
    </Suspense>
  );
}
