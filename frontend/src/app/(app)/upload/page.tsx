'use client';

import dynamic from 'next/dynamic';
import { UploadSkeleton } from '@/components/skeletons';

const UploadPage = dynamic(() => import('@/components/upload/UploadPage'), {
  loading: () => <UploadSkeleton />,
});

export default function UploadRoute() {
  return <UploadPage />;
}
