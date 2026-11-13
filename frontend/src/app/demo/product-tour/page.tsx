'use client';

import dynamic from 'next/dynamic';

const ProductTour = dynamic(() => import('@/components/demo/ProductTour'), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center bg-solid text-sm text-navy-100/80">
      Loading product tour…
    </div>
  ),
});

export default function ProductTourPage() {
  return (
    <div className="h-dvh overflow-hidden bg-paper">
      <ProductTour />
    </div>
  );
}
