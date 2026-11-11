'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ease } from '@/lib/motion';

/** Top bar for the public careers pages: wordmark on the left, one optional action on the right. */
export function PublicHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/60 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/careers/openings" className="flex items-center gap-3" aria-label="AlphaData careers">
          <img src="/alphadatalogo.svg" alt="" className="h-8 w-8 object-contain" />
          <span className="leading-tight">
            <span className="block text-md font-semibold tracking-[-0.02em] text-ink">AlphaData</span>
            <span className="block text-2xs font-semibold uppercase tracking-[0.12em] text-slate-400">Recruitment</span>
          </span>
        </Link>
        {right ?? <div className="w-20" aria-hidden />}
      </div>
    </header>
  );
}

/** Spacer only — copyright lives in the careers layout footer (CV Analyzer). */
export function PublicFooter() {
  return <div className="mt-16" aria-hidden />;
}

/** Fades the page body in once, so the public pages arrive the same way the app does. */
export function PublicBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.main initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }} className={className}>
      {children}
    </motion.main>
  );
}
