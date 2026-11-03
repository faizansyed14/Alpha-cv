'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ease } from '@/lib/motion';

/** Top bar for the public careers pages: wordmark on the left, one optional action on the right. */
export function PublicHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="glass sticky top-0 z-30 border-b border-surface-border">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/careers/openings" className="flex items-center gap-3" aria-label="AlphaData careers">
          <img src="/alphadatalogo.svg" alt="" className="h-8 w-8 object-contain" />
          <span className="leading-tight">
            <span className="block text-md font-semibold tracking-[-0.02em] text-ink">AlphaData</span>
            <span className="block text-2xs font-semibold uppercase tracking-[0.12em] text-slate-400">Recruitment</span>
          </span>
        </Link>
        {right}
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="mt-24 border-t border-surface-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>&copy; {new Date().getFullYear()} AlphaData Recruitment</p>
        <p className="text-xs text-slate-400">Applications are reviewed by our recruitment team.</p>
      </div>
    </footer>
  );
}

/** Fades the page body in once, so the public pages arrive the same way the app does. */
export function PublicBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.main initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }} className={className}>
      {children}
    </motion.main>
  );
}
