'use client';

import dynamic from 'next/dynamic';
import { LoadingPage } from '@/components/ui/loading';

const UploadPage = dynamic(() => import('@/components/upload/UploadPage'), {
  loading: () => <LoadingPage title="Loading..." subtitle="Upload" />,
});

export default function UploadRoute() {
  return <UploadPage />;
}
