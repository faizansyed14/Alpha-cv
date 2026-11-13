'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from '@/components/icons';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

const FilePreviewModal = dynamic(
  () => import('@/components/ui/file-preview-modal').then((mod) => mod.FilePreviewModal),
  { ssr: false },
);

function previewFileName(filename?: string | null, displayName?: string | null) {
  const base = filename || displayName || 'document';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

/**
 * Opens a candidate's original CV file in the preview window. ``open`` starts it; render ``element`` once anywhere in the component.
 * The file is fetched through the download API, so it works for applications and database CVs alike.
 */
export function useCvPreview() {
  const [target, setTarget] = useState<{ cvId: string; fileName: string } | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    let url: string | null = null;
    setError(null);
    setBlobUrl(null);
    (async () => {
      try {
        const { blob } = await api.downloadCV(target.cvId);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'The CV file could not be loaded.');
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [target]);

  const open = useCallback((cvId: string, filename?: string | null, displayName?: string | null) => {
    setTarget({ cvId, fileName: previewFileName(filename, displayName) });
  }, []);
  const close = useCallback(() => setTarget(null), []);

  const element = !target ? null : error ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50" role="alertdialog" aria-label="CV could not be loaded">
      <div className="surface-panel flex max-w-sm flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
        <Button onClick={close} variant="secondary">Close</Button>
      </div>
    </div>
  ) : blobUrl ? (
    <FilePreviewModal isOpen onClose={close} fileUrl={blobUrl} fileName={target.fileName} fileId={target.cvId} />
  ) : (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50" role="status" aria-label="Loading CV">
      <div className="surface-panel flex flex-col items-center gap-3 p-6">
        <Loader2 className="h-8 w-8 animate-spin text-navy-600" />
        <p className="text-sm text-slate-700">Loading the CV…</p>
      </div>
    </div>
  );

  return { open, element };
}
