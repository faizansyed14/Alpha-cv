'use client';

import { useLayoutEffect } from 'react';
import DatabasePage from '@/components/database/DatabasePage';
import { restoreScroll, SCROLL_KEYS } from '@/lib/scrollRestore';

export default function CandidatesRoute() {
  // Apply before paint so Back never flashes the top of the list.
  useLayoutEffect(() => {
    return restoreScroll(SCROLL_KEYS.candidates) || undefined;
  }, []);

  return <DatabasePage lockedView="candidates" />;
}
