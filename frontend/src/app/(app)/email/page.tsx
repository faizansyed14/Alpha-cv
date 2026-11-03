'use client';

import dynamic from 'next/dynamic';
import { EmailSkeleton } from '@/components/skeletons';

const EmailPage = dynamic(() => import('@/components/email/EmailPage'), {
  loading: () => <EmailSkeleton />,
});

export default function EmailRoute() {
  return <EmailPage />;
}
