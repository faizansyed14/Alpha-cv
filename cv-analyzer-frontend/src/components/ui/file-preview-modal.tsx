'use client';
import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Maximize2, FileText } from 'lucide-react';
import { renderAsync } from 'docx-preview';
import mammoth from 'mammoth';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface FilePreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    fileUrl: string;
    fileName: string;
    fileId: string;
    fileType: string;
    extractedText?: string;
    /** When provided, DOCX preview uses this blob instead of fetching fileUrl (avoids empty response / CORS) */
    blob?: Blob | null;
}

type SniffKind = 'pdf' | 'docx' | 'text' | 'binary';

/** Look at the first bytes of the blob so we render by *content*, not by a
 *  filename that is often just the candidate's name with a guessed extension. */
async function sniffBlob(blob: Blob): Promise<SniffKind> {
    try {
        const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
        const ascii = Array.from(head).map((b) => String.fromCharCode(b)).join('');
        if (ascii.startsWith('%PDF-')) return 'pdf';
        // ZIP magic — .docx (and .xlsx/.pptx) are zip containers.
        if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) return 'docx';
        // Legacy OLE .doc
        if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return 'binary';
        // NUL byte in the first 8 bytes => not text we should dump on screen.
        if (head.includes(0)) return 'binary';
        return 'text';
    } catch {
        return 'text';
    }
}

export function FilePreviewModal({ isOpen, onClose, fileUrl, fileName, fileId, fileType, extractedText, blob: blobProp }: FilePreviewModalProps) {
    const [iframeLoaded, setIframeLoaded] = useState(false);
    const [docxReady, setDocxReady] = useState(false);
    const [docxError, setDocxError] = useState(false);
    const [containerMounted, setContainerMounted] = useState(false);
    const [textContent, setTextContent] = useState<string | null>(null);
    const [textLoading, setTextLoading] = useState(false);
    const [sniffed, setSniffed] = useState<SniffKind | null>(null);
    const docxContainerRef = useRef<HTMLDivElement>(null);

    const extLower = fileName.toLowerCase();
    const extPdf = extLower.endsWith('.pdf');
    const extDocx = extLower.endsWith('.docx') || extLower.endsWith('.doc');
    const typePdf = (fileType || '').includes('pdf') || (blobProp?.type || '').includes('pdf');

    // Content sniff wins over the (unreliable) filename extension.
    useEffect(() => {
        let cancelled = false;
        if (!isOpen) { setSniffed(null); return; }
        (async () => {
            let b = blobProp;
            if ((!b || b.size === 0) && fileUrl) {
                try { b = await (await fetch(fileUrl)).blob(); } catch { b = null; }
            }
            if (!b || b.size === 0) { if (!cancelled) setSniffed(null); return; }
            const kind = await sniffBlob(b);
            if (!cancelled) setSniffed(kind);
        })();
        return () => { cancelled = true; };
    }, [isOpen, blobProp, fileUrl]);

    const isPdf = sniffed ? sniffed === 'pdf' : (extPdf || typePdf);
    const isDocx = sniffed ? sniffed === 'docx' : extDocx;
    const isBinaryUnknown = sniffed === 'binary';
    const usePdfIframe = isPdf;
    const isTextLike = !isPdf && !isDocx && !isBinaryUnknown;

    useEffect(() => {
        if (isOpen && usePdfIframe) setIframeLoaded(false);
    }, [isOpen, fileUrl, usePdfIframe]);

    // When the bytes are a PDF but the blob URL was created without an
    // application/pdf type (e.g. the backend served it as text/plain), the
    // <iframe> won't render it. Rebuild a correctly-typed object URL.
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!isOpen || !isPdf) { setPdfUrl(null); return; }
        let url: string | null = null;
        let revoked = false;
        (async () => {
            let b = blobProp;
            if ((!b || b.size === 0) && fileUrl) {
                try { b = await (await fetch(fileUrl)).blob(); } catch { b = null; }
            }
            if (!b || b.size === 0) { setPdfUrl(fileUrl || null); return; }
            const typed = b.type === 'application/pdf' ? b : new Blob([b], { type: 'application/pdf' });
            url = URL.createObjectURL(typed);
            if (!revoked) setPdfUrl(url);
        })();
        return () => { revoked = true; if (url) URL.revokeObjectURL(url); };
    }, [isOpen, isPdf, blobProp, fileUrl]);
    const effectivePdfUrl = pdfUrl || fileUrl;

    // For text/UTF-8 CVs (e.g. pasted-text uploads with no original PDF), load the
    // content and render it inline so the user sees the CV directly instead of a
    // "Preview not available" dead-end.
    useEffect(() => {
        if (!isOpen || !isTextLike) {
            setTextContent(null);
            setTextLoading(false);
            return;
        }
        if (extractedText) {
            setTextContent(extractedText);
            return;
        }
        let cancelled = false;
        setTextLoading(true);
        setTextContent(null);
        (async () => {
            try {
                let text = '';
                if (blobProp && blobProp.size > 0) {
                    text = await blobProp.text();
                } else if (fileUrl) {
                    const res = await fetch(fileUrl);
                    text = await res.text();
                }
                if (!cancelled) setTextContent(text);
            } catch {
                if (!cancelled) setTextContent(null);
            } finally {
                if (!cancelled) setTextLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, isTextLike, fileUrl, blobProp, extractedText]);

    // Render DOCX. Primary: docx-preview (keeps layout/formatting close to Word).
    // Fallback: mammoth (converts to plain-ish HTML) — far more forgiving of the
    // "unusual" .docx files that trip up docx-preview's stricter renderer, so a
    // document only falls through to "download instead" if BOTH fail.
    useEffect(() => {
        if (!isOpen || !isDocx) {
            setDocxReady(false);
            setDocxError(false);
            setContainerMounted(false);
            return;
        }
        const container = docxContainerRef.current;
        if (!container) return;
        setDocxReady(false);
        setDocxError(false);
        container.innerHTML = '';
        let cancelled = false;
        (async () => {
            let blob: Blob;
            try {
                if (blobProp && blobProp.size > 0) {
                    blob = blobProp;
                } else if (fileUrl) {
                    const res = await fetch(fileUrl);
                    if (!res.ok) throw new Error('Failed to load document');
                    blob = await res.blob();
                    if (blob.size === 0) throw new Error('Document is empty');
                } else {
                    throw new Error('No file source');
                }
            } catch (e) {
                if (!cancelled) setDocxError(true);
                return;
            }
            if (cancelled) return;

            try {
                await renderAsync(blob, container);
                if (!cancelled) setDocxReady(true);
                return;
            } catch (primaryError) {
                console.warn('docx-preview failed, falling back to mammoth:', primaryError);
            }
            if (cancelled) return;

            try {
                const arrayBuffer = await blob.arrayBuffer();
                const result = await mammoth.convertToHtml({ arrayBuffer });
                if (cancelled) return;
                container.innerHTML = `<div class="mammoth-fallback">${result.value}</div>`;
                setDocxReady(true);
            } catch (fallbackError) {
                console.error('mammoth fallback also failed:', fallbackError);
                if (!cancelled) setDocxError(true);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, isDocx, fileUrl, blobProp, containerMounted]);

    const handleDownload = () => {
        const link = document.createElement('a');
        link.href = fileUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-5xl w-[90vw] h-[90vh] flex flex-col p-0 overflow-hidden bg-white border-gray-200">
                <DialogTitle className="sr-only">Preview: {fileName}</DialogTitle>
                {/* Header chrome */}
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                        <span className="truncate text-[13px] font-medium text-gray-900">{fileName}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={handleDownload} icon={<Download />}>
                            Download
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="h-8 w-8"
                            aria-label="Close"
                            icon={<X />}
                        />
                    </div>
                </div>

                <div className="flex-1 flex flex-col min-h-0 relative bg-gray-50">
                    {usePdfIframe ? (
                        <>
                            {!iframeLoaded && (
                                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-50">
                                    <div className="mb-3 h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                                    <p className="text-[13px] text-gray-600">Loading document…</p>
                                </div>
                            )}
                            <iframe
                                src={effectivePdfUrl}
                                title={`Preview: ${fileName}`}
                                className="flex-1 w-full min-h-0 border-0"
                                onLoad={() => setIframeLoaded(true)}
                            />
                        </>
                    ) : isDocx ? (
                        <>
                            {!docxReady && !docxError && (
                                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-50">
                                    <div className="mb-3 h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                                    <p className="text-[13px] text-gray-600">Loading document…</p>
                                </div>
                            )}
                            {docxError && (
                                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-gray-50 p-6">
                                    <p className="text-[13px] text-red-600">Could not preview this document.</p>
                                    <Button variant="primary" onClick={handleDownload} icon={<Download />}>
                                        Download
                                    </Button>
                                </div>
                            )}
                            <div
                                ref={(el) => {
                                    (docxContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                                    setContainerMounted(!!el);
                                }}
                                className="docx-container flex-1 overflow-auto p-6 min-h-0"
                                style={{ background: '#fff' }}
                            />
                        </>
                    ) : (
                        <div className="flex-1 overflow-auto p-6">
                            {textLoading ? (
                                <div className="flex h-full flex-col items-center justify-center">
                                    <div className="mb-3 h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                                    <p className="text-[13px] text-gray-600">Loading document…</p>
                                </div>
                            ) : (textContent && textContent.trim().length > 0) ? (
                                <div className="overflow-auto rounded-lg border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                                    <div className="mb-4 flex items-center justify-between">
                                        <h3 className="section-label flex items-center gap-2">
                                            <FileText className="h-4 w-4" /> Raw document content
                                        </h3>
                                        <Badge variant="secondary">{textContent.length} characters</Badge>
                                    </div>
                                    <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-gray-700" style={{ fontFamily: 'ui-monospace, monospace' }}>
                                        {textContent}
                                    </pre>
                                </div>
                            ) : (
                                <div className="flex h-full flex-col items-center justify-center p-8">
                                    <div className="flex max-w-md flex-col items-center rounded-lg border border-gray-200 bg-white p-10 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                                        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                                            <Maximize2 className="h-6 w-6 text-gray-400" />
                                        </div>
                                        <h3 className="text-sm font-semibold text-gray-900">Preview not available</h3>
                                        <p className="mb-6 mt-1 text-[13px] text-gray-500">
                                            {isBinaryUnknown
                                                ? "This is a legacy .doc file — browsers can't render the old Word binary format in-page. Download it to view in Word."
                                                : 'This document could not be displayed. You can download the original file.'}
                                        </p>
                                        <div className="flex gap-2">
                                            <Button variant="primary" onClick={handleDownload} icon={<Download />}>
                                                Download original
                                            </Button>
                                            <Button variant="secondary" onClick={() => window.open(fileUrl, '_blank')}>
                                                Open file
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
