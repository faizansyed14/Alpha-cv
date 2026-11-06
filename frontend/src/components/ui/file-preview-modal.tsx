'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Download, FileText, FileWarning, ZoomIn, ZoomOut } from '@/components/icons';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RasterPreview } from '@/components/ui/raster-preview';

interface FilePreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    fileUrl: string;
    fileName: string;
    /** Id of the CV / JD, used to ask the server to draw pages of formats a browser cannot show. */
    fileId: string;
    /** Ignored: the kind of file is read from its bytes (callers often pass a guessed name and type). */
    fileType?: string;
    extractedText?: string;
    docType?: 'cv' | 'jd';
    /** When provided, the preview uses this blob instead of fetching fileUrl. */
    blob?: Blob | null;
}

type Kind = 'pdf' | 'word' | 'legacy' | 'rtf' | 'text';

/** Look at the first bytes so we render by *content*, not by a filename that is often a candidate's name with a
 *  guessed extension. Nothing is mounted until this is known: pointing a PDF frame at a Word file makes the
 *  browser download it instead of showing it. */
async function sniff(blob: Blob): Promise<Kind> {
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    const ascii = Array.from(head).map((b) => String.fromCharCode(b)).join('');
    if (ascii.startsWith('%PDF-')) return 'pdf';
    if (ascii.startsWith('{\\rtf')) return 'rtf';
    if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) return 'word'; // zip: .docx / .odt
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return 'legacy'; // OLE: .doc
    return head.includes(0) ? 'legacy' : 'text';
}

const EXT: Record<Kind, string> = { pdf: '.pdf', word: '.docx', legacy: '.doc', rtf: '.rtf', text: '.txt' };

function Spinner({ label = 'Loading document…' }: { label?: string }) {
    return (
        <div className="flex h-full flex-col items-center justify-center">
            <div className="mb-3 h-10 w-10 animate-spin rounded-full border-2 border-navy-500 border-t-transparent" />
            <p className="text-[13px] text-slate-600">{label}</p>
        </div>
    );
}

/**
 * A Word file drawn as real pages, the way the Al-ain viewer does it (@extend-ai/react-docx). If that library cannot
 * read the file, docx-preview and then mammoth are tried before giving up (the caller then shows the server-drawn pages).
 */
function WordPreview({ blob, zoom, onFail }: { blob: Blob; zoom: number; onFail: () => void }) {
    const [lib, setLib] = useState<typeof import('@extend-ai/react-docx') | null>(null);
    const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
    const [stage, setStage] = useState<'viewer' | 'docx-preview' | 'mammoth'>('viewer');
    const fallback = useRef<HTMLDivElement>(null);
    const failRef = useRef(onFail);
    failRef.current = onFail;

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const bytes = await blob.arrayBuffer();
                const l = await import('@extend-ai/react-docx');
                await l.parseDocx(bytes.slice(0)); // a file the viewer cannot read fails here, not inside it
                if (cancelled) return;
                setLib(l);
                setBuffer(bytes);
            } catch {
                if (!cancelled) setStage('docx-preview');
            }
        })();
        return () => { cancelled = true; };
    }, [blob]);

    useEffect(() => {
        if (stage === 'viewer') return;
        const box = fallback.current;
        if (!box) return;
        let cancelled = false;
        box.innerHTML = '';
        (async () => {
            try {
                if (stage === 'docx-preview') {
                    const { renderAsync } = await import('docx-preview');
                    await renderAsync(blob, box);
                } else {
                    const mammoth = (await import('mammoth')).default;
                    const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
                    if (!cancelled) box.innerHTML = `<div class="mammoth-fallback">${result.value}</div>`;
                }
            } catch {
                if (cancelled) return;
                if (stage === 'docx-preview') setStage('mammoth');
                else failRef.current();
            }
        })();
        return () => { cancelled = true; };
    }, [stage, blob]);

    return (
        <div className="h-full w-full overflow-auto bg-slate-200/70">
            {stage === 'viewer' ? (
                buffer && lib ? (
                    <div className="flex p-6" style={{ justifyContent: 'safe center' }}>
                        <div style={{ zoom }} className="bg-white shadow-[0_2px_16px_rgba(15,23,42,0.18)]">
                            <lib.ReactDocxViewer file={buffer} emptyState={<Spinner label="Opening document…" />} />
                        </div>
                    </div>
                ) : (
                    <Spinner label="Opening document…" />
                )
            ) : (
                <div className="flex p-6" style={{ justifyContent: 'safe center' }}>
                    <div ref={fallback} style={{ zoom }} className="docx-container bg-white shadow-[0_2px_16px_rgba(15,23,42,0.18)]" />
                </div>
            )}
        </div>
    );
}

export function FilePreviewModal({ isOpen, onClose, fileUrl, fileName, fileId, extractedText, docType = 'cv', blob: blobProp }: FilePreviewModalProps) {
    const [loaded, setLoaded] = useState<{ blob: Blob; kind: Kind } | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [pdfReady, setPdfReady] = useState(false);
    const [wordFailed, setWordFailed] = useState(false);
    const [rasterFailed, setRasterFailed] = useState(false);
    const [text, setText] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);

    // 1. Get the bytes and look at them, before anything is drawn.
    useEffect(() => {
        setLoaded(null);
        setLoadError(false);
        setWordFailed(false);
        setRasterFailed(false);
        setText(null);
        setPdfReady(false);
        setZoom(1);
        if (!isOpen) return;
        let cancelled = false;
        (async () => {
            try {
                let b: Blob | null | undefined = blobProp && blobProp.size > 0 ? blobProp : null;
                if (!b && fileUrl) {
                    const res = await fetch(fileUrl);
                    if (!res.ok) throw new Error('Failed to load document');
                    b = await res.blob();
                }
                if (!b || b.size === 0) throw new Error('Document is empty');
                const kind = await sniff(b);
                if (!cancelled) setLoaded({ blob: b, kind });
            } catch {
                if (!cancelled) setLoadError(true);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, blobProp, fileUrl]);

    // 2. A PDF gets a correctly-typed object URL (the server may have labelled the bytes as something else).
    useEffect(() => {
        if (!loaded || loaded.kind !== 'pdf') { setPdfUrl(null); return; }
        const typed = loaded.blob.type === 'application/pdf' ? loaded.blob : new Blob([loaded.blob], { type: 'application/pdf' });
        const url = URL.createObjectURL(typed);
        setPdfUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [loaded]);

    // 3. Plain text (and the last resort for anything the viewers could not draw).
    const kind = loaded?.kind;
    const needsText = !!loaded && (kind === 'text' || (kind === 'word' && wordFailed && rasterFailed) || ((kind === 'legacy' || kind === 'rtf') && (rasterFailed || !fileId)));
    useEffect(() => {
        if (!needsText || !loaded) return;
        if (extractedText) { setText(extractedText); return; }
        if (kind !== 'text') return;
        let cancelled = false;
        loaded.blob.text().then((t) => { if (!cancelled) setText(t); }).catch(() => { if (!cancelled) setText(null); });
        return () => { cancelled = true; };
    }, [needsText, loaded, kind, extractedText]);

    const displayName = kind && kind !== 'pdf' ? fileName.replace(/\.pdf$/i, '') : fileName;

    const handleDownload = useCallback(() => {
        const source = loaded?.blob;
        const url = source ? URL.createObjectURL(source) : fileUrl;
        const name = kind && !displayName.toLowerCase().endsWith(EXT[kind]) && !/\.[a-z0-9]{2,5}$/i.test(displayName) ? `${displayName}${EXT[kind]}` : displayName;
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (source) setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, [loaded, kind, displayName, fileUrl]);

    const canZoom = kind === 'word' && !wordFailed;
    const drawnByServer = (kind === 'legacy' || kind === 'rtf' || (kind === 'word' && wordFailed)) && !!fileId && !rasterFailed;

    const unavailable = (
        <div className="flex h-full flex-col items-center justify-center p-8">
            <div className="flex max-w-md flex-col items-center rounded-2xl border border-surface-border bg-white p-10 text-center shadow-card">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100">
                    <FileWarning className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">Preview not available</h3>
                <p className="mb-6 mt-1 text-[13px] text-slate-500">This document could not be displayed here. You can download the original file.</p>
                <Button variant="primary" onClick={handleDownload} icon={<Download />}>Download original</Button>
            </div>
        </div>
    );

    let body: React.ReactNode;
    if (loadError) body = unavailable;
    else if (!loaded) body = <Spinner />;
    else if (kind === 'pdf') {
        body = (
            <>
                {!pdfReady && <div className="absolute inset-0 z-10 bg-slate-50"><Spinner /></div>}
                {pdfUrl ? (
                    <iframe src={pdfUrl} title={`Preview: ${displayName}`} className="h-full w-full flex-1 border-0" onLoad={() => setPdfReady(true)} />
                ) : null}
            </>
        );
    } else if (kind === 'word' && !wordFailed) {
        body = <WordPreview blob={loaded.blob} zoom={zoom} onFail={() => setWordFailed(true)} />;
    } else if (drawnByServer) {
        body = <RasterPreview docId={fileId} docType={docType} onUnavailable={() => setRasterFailed(true)} />;
    } else if (text && text.trim().length > 0) {
        body = (
            <div className="h-full overflow-auto p-6">
                <div className="mx-auto max-w-3xl rounded-xl border border-surface-border bg-white p-6 shadow-card">
                    <div className="mb-4 flex items-center justify-between">
                        <h3 className="section-label flex items-center gap-2"><FileText className="h-4 w-4" /> Document text</h3>
                        <Badge variant="secondary">{text.length.toLocaleString()} characters</Badge>
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-slate-700">{text}</pre>
                </div>
            </div>
        );
    } else {
        body = unavailable;
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent hideClose className="flex h-[90vh] w-[90vw] max-w-5xl flex-col overflow-hidden border-surface-border bg-white p-0">
                <DialogTitle className="sr-only">Preview: {displayName}</DialogTitle>
                <div className="flex items-center justify-between gap-3 border-b border-surface-border bg-white px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-600">
                            <FileText className="h-4 w-4" />
                        </span>
                        <span className="truncate text-[13px] font-semibold text-slate-900">{displayName}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        {canZoom && (
                            <div className="mr-1 flex items-center gap-0.5 rounded-lg border border-surface-border bg-slate-50 p-0.5">
                                <button type="button" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))} className="rounded-md p-1.5 text-slate-500 hover:bg-white hover:text-slate-900" aria-label="Zoom out">
                                    <ZoomOut className="h-4 w-4" />
                                </button>
                                <button type="button" onClick={() => setZoom(1)} className="min-w-[3rem] rounded-md px-1 text-xs font-semibold tabular-nums text-slate-600 hover:bg-white" title="Reset zoom">
                                    {Math.round(zoom * 100)}%
                                </button>
                                <button type="button" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))} className="rounded-md p-1.5 text-slate-500 hover:bg-white hover:text-slate-900" aria-label="Zoom in">
                                    <ZoomIn className="h-4 w-4" />
                                </button>
                            </div>
                        )}
                        <Button variant="secondary" size="sm" onClick={handleDownload} icon={<Download />}>Download</Button>
                        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" aria-label="Close" icon={<X />} />
                    </div>
                </div>
                <div className="relative flex min-h-0 flex-1 flex-col bg-slate-50">{body}</div>
            </DialogContent>
        </Dialog>
    );
}
