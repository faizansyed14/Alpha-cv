'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, FileWarning, Loader2 } from '@/components/icons';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { RasterPreview } from '@/components/ui/raster-preview';

async function isPdf(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return Array.from(head).map((b) => String.fromCharCode(b)).join('') === '%PDF-';
}

/** Inline original CV under the profile — PDF in an iframe, other formats via server-drawn pages. */
export function CvDocumentViewer({ cvId, filename }: { cvId: string; filename?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [pdf, setPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadName, setDownloadName] = useState(filename || 'cv.pdf');

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);
    (async () => {
      try {
        const { blob, filename: serverName } = await api.downloadCV(cvId);
        if (cancelled) return;
        if (!blob || blob.size === 0) throw new Error('Document is empty');
        const asPdf = await isPdf(blob);
        url = URL.createObjectURL(blob);
        setPdf(asPdf);
        setBlobUrl(url);
        if (serverName) setDownloadName(serverName);
        else if (filename) setDownloadName(filename);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load document');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [cvId, filename]);

  const download = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-800">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900">Original CV</p>
            <p className="truncate text-[12px] text-slate-500">{downloadName}</p>
          </div>
        </div>
        <Button type="button" variant="secondary" size="sm" icon={<Download />} onClick={download} disabled={!blobUrl}>
          Download
        </Button>
      </div>

      <div className="relative min-h-[70vh] bg-slate-50">
        {loading ? (
          <div className="flex h-[70vh] flex-col items-center justify-center gap-2 text-[13px] text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-navy-700" />
            Loading document…
          </div>
        ) : error ? (
          <div className="flex h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
            <FileWarning className="h-8 w-8 text-amber-600" />
            <p className="text-[13px] text-slate-600">{error}</p>
            <p className="text-[12px] text-slate-400">Showing server page preview if available.</p>
            <div className="mt-2 w-full max-w-3xl">
              <RasterPreview docId={cvId} docType="cv" />
            </div>
          </div>
        ) : pdf && blobUrl ? (
          <iframe title={`CV: ${downloadName}`} src={blobUrl} className="h-[80vh] w-full border-0 bg-white" />
        ) : (
          <div className="p-4">
            <RasterPreview docId={cvId} docType="cv" />
          </div>
        )}
      </div>
    </div>
  );
}
