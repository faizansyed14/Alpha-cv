'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { workspacePath, type WorkspaceId } from '@/lib/navigation';
import { useAppStore } from '@/stores/appStore';

/**
 * Navigate to a workspace URL. Preserves matching Zustand state.
 * Optionally syncs legacy currentTab for any remaining consumers.
 */
export function useWorkspaceNav() {
  const router = useRouter();
  const setCurrentTab = useAppStore((s) => s.setCurrentTab);

  const go = useCallback(
    (id: WorkspaceId | string) => {
      const path = workspacePath(id);
      // Keep legacy tab field in sync for any leftover consumers during migration
      const tabId =
        id === 'careers-manage' || id === 'careers'
          ? 'careers'
          : id === 'database'
            ? 'candidates'
            : id;
      try {
        setCurrentTab(tabId as Parameters<typeof setCurrentTab>[0]);
      } catch {
        /* ignore */
      }
      router.push(path);
    },
    [router, setCurrentTab],
  );

  return { go, router };
}
