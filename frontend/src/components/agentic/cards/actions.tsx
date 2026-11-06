'use client';

import dynamic from 'next/dynamic';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from '@/components/icons';
import { api } from '@/lib/api';

const FilePreviewModal = dynamic(() => import('@/components/ui/file-preview-modal').then((m) => m.FilePreviewModal), { ssr: false });

/**
 * What a card can do besides sending a plain message. The page provides these so every card (candidates, matches, applications,
 * job descriptions, profiles) behaves the same way:
 *  - preview: open the original document in the same viewer the Database and Match pages use
 *  - review / focus: act on ONE exact candidate or job by id (two people can share a name)
 *  - decide: answer a proposed change (Confirm / Cancel); the server uses the proposal it saved, never anything sent from here
 */
export interface CardActions {
  preview: (id: string, type: 'cv' | 'jd', name?: string) => void;
  review: (cvId: string, name: string) => void;
  focus: (text: string, target: { cv_id?: string; job_id?: string; name: string }) => void;
  decide: (kind: 'confirm' | 'cancel_action', actionId: string, label: string) => void;
}

const noop: CardActions = { preview: () => undefined, review: () => undefined, focus: () => undefined, decide: () => undefined };
const Ctx = createContext<CardActions>(noop);

export function CardActionsProvider({ value, children }: { value: CardActions; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCardActions(): CardActions {
  return useContext(Ctx);
}

type PreviewState = { id: string; type: 'cv' | 'jd'; name: string; url: string | null; error: string | null } | null;

/**
 * The document preview, same flow as the Database and Match pages: the original file is fetched as the signed-in person
 * (their own access rules apply) and shown in the shared viewer. Returns `open` and the element to render once on the page.
 */
export function useDocPreview() {
  const [state, setState] = useState<PreviewState>(null);
  const urlRef = useRef<string | null>(null);

  const release = () => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
  };
  useEffect(() => release, []);

  const close = useCallback(() => { release(); setState(null); }, []);

  const open = useCallback(async (id: string, type: 'cv' | 'jd', rawName?: string) => {
    const base = (rawName || (type === 'cv' ? 'document' : 'job-description')).trim();
    const name = base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;     // the viewer reads the real bytes; the name is only a label
    release();
    setState({ id, type, name, url: null, error: null });
    try {
      const blob = type === 'cv' ? (await api.downloadCV(id)).blob : await api.downloadStorageFile('jd', id);
      if (!blob || blob.size === 0) throw new Error('The document is empty.');
      urlRef.current = URL.createObjectURL(blob);
      setState({ id, type, name, url: urlRef.current, error: null });
    } catch (e: any) {
      setState({ id, type, name, url: null, error: e?.detail || e?.response?.data?.detail || (e?.response?.status === 404 ? 'The original file is not stored for this document.' : e?.message) || 'The document could not be loaded.' });
    }
  }, []);

  const node = state ? (
    state.url ? (
      <FilePreviewModal isOpen onClose={close} fileUrl={state.url} fileName={state.name} fileId={state.id} docType={state.type} />
    ) : (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={state.error ? close : undefined}>
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
          {state.error ? (
            <>
              <p className="text-center text-[13px] text-rose-600">{state.error}</p>
              <button type="button" onClick={close} className="rounded-full border border-slate-200 px-4 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50">Close</button>
            </>
          ) : (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-navy-700" />
              <p className="text-[13px] text-slate-700">Loading document...</p>
            </>
          )}
        </div>
      </div>
    )
  ) : null;

  return { open, node };
}
