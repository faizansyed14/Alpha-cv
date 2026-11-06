'use client';

import { use } from 'react';
import CandidateProfilePage from '@/components/database/CandidateProfilePage';

export default function CandidateProfileRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CandidateProfilePage cvId={id} />;
}
