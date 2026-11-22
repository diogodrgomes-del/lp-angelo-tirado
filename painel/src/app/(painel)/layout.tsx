import { Suspense } from 'react';
import { PRODUCT_NAME } from '@/config';
import Nav from '@/components/Nav';

export const dynamic = 'force-dynamic';

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8">
      <Suspense fallback={<div className="h-12 border-b border-borda" />}>
        <Nav product={PRODUCT_NAME} />
      </Suspense>
      <div className="mt-8">{children}</div>
    </div>
  );
}
