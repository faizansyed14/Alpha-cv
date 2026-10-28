'use client';

import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import type { ConfirmDeleteType } from '../types';

type Props = {
  confirmDeleteId: string | null;
  confirmDeleteType: ConfirmDeleteType | null;
  token: string | null;
  apiTeam: import('@/lib/trackerApi').TrackerTeam | undefined;
  rowBusy: Record<string, boolean>;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function DeleteConfirmDialog({
  confirmDeleteId,
  confirmDeleteType,
  token,
  onCancel,
  onConfirm,
}: Props) {
  if (!confirmDeleteId || !confirmDeleteType) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative animate-page-enter mx-4 w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-[var(--shadow-md)] z-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              Delete {confirmDeleteType === 'job' ? 'Requirement' : confirmDeleteType === 'candidate' ? 'Candidate' : 'Follow-up'}?
            </p>
            <p className="text-sm text-slate-500 mt-0.5">This action cannot be undone.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white"
            disabled={!token}
            onClick={() => void onConfirm()}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
