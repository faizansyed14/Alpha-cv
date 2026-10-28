'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Save } from 'lucide-react';
import type { TextPeekState } from '../types';

type Props = {
  textPeek: TextPeekState;
  textPeekDraft: string;
  textPeekSaving: boolean;
  onClose: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void | Promise<void>;
};

export function TextPeekDialog({ textPeek, textPeekDraft, textPeekSaving, onClose, onDraftChange, onSave }: Props) {
  if (!textPeek) return null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg animate-page-enter border-slate-200 bg-white text-slate-900 shadow-[var(--shadow-md)]">
        <DialogHeader>
          <DialogTitle className="text-slate-900">{textPeek.title}</DialogTitle>
          <DialogDescription>{textPeek.canEdit ? 'View & edit' : 'Full text'}</DialogDescription>
        </DialogHeader>
        {textPeek.canEdit ? (
          <textarea
            value={textPeekDraft}
            onChange={(e) => onDraftChange(e.target.value)}
            className="w-full min-h-[220px] max-h-[55vh] resize-y text-[13px] text-slate-900 border border-slate-200 rounded-lg p-3 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            placeholder="Type here…"
          />
        ) : (
          <div className="whitespace-pre-wrap text-[13px] text-slate-800 border border-slate-200 rounded-lg p-3 bg-slate-50 max-h-[55vh] overflow-auto">
            {textPeek.text}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="outline" onClick={onClose} disabled={textPeekSaving}>
            Close
          </Button>
          {textPeek.canEdit ? (
            <Button
              className="bg-brand-600 text-white hover:bg-brand-700"
              disabled={textPeekSaving}
              onClick={() => void onSave()}
            >
              {textPeekSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2 text-white" /> : <Save className="w-4 h-4 mr-2 text-white" />}
              <span className="text-white">Save</span>
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
