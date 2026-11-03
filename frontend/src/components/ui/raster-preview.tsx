'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

/**
 * Pages of a CV or JD drawn by the server from its extracted text. Used for formats a browser cannot show in-page
 * (legacy .doc, RTF, ODT, HTML): the same approach the Al-ain RAG viewer uses for Office documents.
 */
export function RasterPreview({ docId, docType = 'cv', onUnavailable }: { docId: string; docType?: 'cv' | 'jd'; onUnavailable?: () => void }) {
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [src, setSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const unavailable = useRef(onUnavailable);   // a ref, so a new callback identity never refetches the page
    unavailable.current = onUnavailable;

    useEffect(() => {
        let cancelled = false;
        let url: string | null = null;
        setLoading(true);
        (docType === 'jd' ? api.getJDPreviewPage(docId, page) : api.getCVPreviewPage(docId, page))
            .then(({ blob, pages: total }) => {
                if (cancelled) return;
                url = URL.createObjectURL(blob);
                setSrc(url);
                setPages(total);
            })
            .catch(() => !cancelled && unavailable.current?.())
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [docId, docType, page]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex-1 overflow-auto bg-slate-100 p-4">
                {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={`Page ${page} of ${pages}`} className={`mx-auto max-w-full rounded border border-slate-200 bg-white shadow-sm transition-opacity ${loading ? 'opacity-60' : ''}`} />
                ) : (
                    <p className="py-16 text-center text-sm text-slate-500">{loading ? 'Rendering preview…' : 'No preview'}</p>
                )}
            </div>
            {pages > 1 ? (
                <div className="flex items-center justify-center gap-3 border-t border-slate-200 bg-white py-2 text-sm">
                    <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                    <span className="tabular-nums text-slate-600">Page {page} of {pages}</span>
                    <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
            ) : null}
        </div>
    );
}
