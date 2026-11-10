import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AlphaCV product tour',
  description: 'Business demo walkthrough with fictional sample data',
  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-white">{children}</div>;
}
