'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Download, ExternalLink, Loader2, RefreshCw } from '@/components/icons';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function fileNameFor(title: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'job';
  return `hiring-${slug}.jpg`;
}

/**
 * The "We are hiring" picture for a job, ready to post: a 1080 x 1080 JPEG drawn from the job's title and city (no AI model is used).
 * Shows it, and saves it or opens it full size.
 */
export default function HiringImageDialog({ jobId, title, onClose }: { jobId: string; title?: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const b = await api.getJobHiringImage(jobId);
      setBlob(b);
      setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b); });
    } catch (e: any) {
      setError(e?.detail || e?.response?.data?.detail || e?.message || 'The picture could not be created. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
    return () => setUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
  }, [load]);

  const save = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameFor(title || 'job');
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-5">
        <DialogHeader>
          <DialogTitle>Hiring image</DialogTitle>
          <DialogDescription>A 1080 × 1080 picture for LinkedIn, Instagram or WhatsApp.</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-xl border border-surface-border bg-slate-50">
          {loading ? (
            <div className="flex aspect-square h-[min(52vh,440px)] flex-col items-center justify-center gap-2 text-sm text-slate-500" role="status">
              <Loader2 className="h-6 w-6 animate-spin text-navy-600" /> Drawing the picture…
            </div>
          ) : error ? (
            <div className="flex aspect-square h-[min(52vh,440px)] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-red-700" role="alert">
              <AlertCircle className="h-6 w-6" /> {error}
            </div>
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={`We are hiring: ${title || 'new role'}`} className="block aspect-square h-[min(52vh,440px)] w-auto max-w-full object-contain" />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-border pt-3">
          <p className="text-xs text-slate-500">{blob ? `JPEG, ${Math.round(blob.size / 1024)} KB` : ' '}</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void load()} disabled={loading}>Redraw</Button>
            <Button variant="secondary" size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => url && window.open(url, '_blank', 'noopener')} disabled={!url}>Full size</Button>
            <Button variant="primary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={save} disabled={!url}>Download JPG</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
