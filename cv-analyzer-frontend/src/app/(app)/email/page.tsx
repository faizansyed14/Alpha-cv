'use client';

import dynamic from 'next/dynamic';
import { LoadingPage } from '@/components/ui/loading';

const EmailPage = dynamic(() => import('@/components/email/EmailPage'), {
  loading: () => <LoadingPage title="Loading..." subtitle="Email" />,
});

export default function EmailRoute() {
  return <EmailPage />;
}
