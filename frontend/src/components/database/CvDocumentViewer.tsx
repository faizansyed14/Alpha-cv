'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, FileWarning, Loader2 } from '@/components/icons';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { RasterPreview } from '@/components/ui/raster-preview';
import { WordPreview, sniff, type Kind } from '@/components/ui/file-preview-modal';

/**
 * Inline original CV under the profile. It draws the file the same way the "view CV" window does (the same download, the same viewers),
 * chosen by what the file really is: a PDF in a frame, a Word file as real pages, an old .doc / RTF as server-drawn pages, plain text as text.
 */
export function CvDocumentViewer({ cvId, filename }: { cvId: string; filename?: string }) {
  const [loaded, setLoaded] = useState<{ blob: Blob; kind: Kind } | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wordFailed, setWordFailed] = useState(false);
  const [rasterFailed, setRasterFailed] = useState(false);
  const [downloadName, setDownloadName] = useState(filename || 'cv.pdf');

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setLoading(true);
    setError(null);
    setLoaded(null);
    setBlobUrl(null);
    setText(null);
    setWordFailed(false);
    setRasterFailed(false);
    (async () => {
      try {
        const { blob, filename: serverName } = await api.downloadCV(cvId);
        if (cancelled) return;
        if (!blob || blob.size === 0) throw new Error('Document is empty');
        const kind = await sniff(blob);
        if (cancelled) return;
        // a PDF needs the right type to open in a frame; the server may have labelled the bytes as something else
        const typed = kind === 'pdf' && blob.type !== 'application/pdf' ? new Blob([blob], { type: 'application/pdf' }) : blob;
        url = URL.createObjectURL(typed);
        setBlobUrl(url);
        setLoaded({ blob: typed, kind });
        if (serverName) setDownloadName(serverName);
        else if (filename) setDownloadName(filename);
        if (kind === 'text') setText(await blob.text());
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

  const kind = loaded?.kind;
  const serverDrawn = (kind === 'legacy' || kind === 'rtf' || (kind === 'word' && wordFailed)) && !rasterFailed;

  const unavailable = (
    <div className="flex h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <FileWarning className="h-8 w-8 text-amber-600" />
      <p className="text-sm text-slate-600">This document could not be displayed here. You can download the original file.</p>
    </div>
  );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin text-navy-700" />
        Loading document…
      </div>
    );
  } else if (error || !loaded) {
    body = (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <FileWarning className="h-8 w-8 text-amber-600" />
        <p className="text-sm text-slate-600">{error ?? 'Failed to load document'}</p>
        <p className="text-xs text-slate-400">Showing server page preview if available.</p>
        <div className="mt-2 w-full max-w-3xl">
          <RasterPreview docId={cvId} docType="cv" />
        </div>
      </div>
    );
  } else if (kind === 'pdf' && blobUrl) {
    body = <iframe title={`CV: ${downloadName}`} src={blobUrl} className="h-[80vh] w-full border-0 bg-paper" />;
  } else if (kind === 'word' && !wordFailed) {
    body = (
      <div className="h-[80vh]">
        <WordPreview blob={loaded.blob} zoom={1} onFail={() => setWordFailed(true)} />
      </div>
    );
  } else if (serverDrawn) {
    body = (
      <div className="p-4">
        <RasterPreview docId={cvId} docType="cv" onUnavailable={() => setRasterFailed(true)} />
      </div>
    );
  } else if (text && text.trim()) {
    body = (
      <div className="max-h-[80vh] overflow-auto p-4">
        <pre className="whitespace-pre-wrap rounded-xl border border-surface-border bg-paper p-5 font-mono text-sm leading-relaxed text-slate-700">{text}</pre>
      </div>
    );
  } else {
    body = unavailable;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-surface-border bg-paper shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-800">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Original CV</p>
            <p className="truncate text-xs text-slate-500">{downloadName}</p>
          </div>
        </div>
        <Button type="button" variant="secondary" size="sm" icon={<Download />} onClick={download} disabled={!blobUrl}>
          Download
        </Button>
      </div>

      <div className="relative min-h-[40vh] bg-slate-50">{body}</div>
    </div>
  );
}
