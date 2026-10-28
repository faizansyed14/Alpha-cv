'use client';

import type { TrackerTeam } from '@/lib/trackerApi';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

type Props = {
  open: boolean;
  importTeam: TrackerTeam;
  importFile: File | null;
  importBusy: boolean;
  token: string | null;
  onOpenChange: (open: boolean) => void;
  onImportTeamChange: (team: TrackerTeam) => void;
  onImportFileChange: (file: File | null) => void;
  onImport: () => void | Promise<void>;
  onCancel: () => void;
};

export function ImportSelectionsModal({
  open,
  importTeam,
  importFile,
  importBusy,
  token,
  onOpenChange,
  onImportTeamChange,
  onImportFileChange,
  onImport,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg animate-page-enter border-slate-200 bg-white text-slate-900 shadow-[var(--shadow-md)]">
        <DialogHeader>
          <DialogTitle className="text-slate-900">Upload Selections & Joinings Excel</DialogTitle>
          <DialogDescription>
            Upload the exported <span className="font-semibold">candidates.xlsx</span> and choose which team table to import into.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-slate-600">Team</div>
            <Select value={importTeam} onValueChange={(v) => onImportTeamChange(v as TrackerTeam)}>
              <SelectTrigger className="h-9 bg-white border-slate-200 text-slate-900">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dubai">Dubai</SelectItem>
                <SelectItem value="abudhabi">Abu Dhabi</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-slate-600">Excel file</div>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => onImportFileChange(e.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
            />
            <div className="text-[12px] text-slate-500">
              Tip: Use the Tracker export for Selections & Joinings (it matches the required columns).
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              disabled={!token || !importFile || importBusy}
              onClick={() => void onImport()}
              className="bg-brand-600 hover:bg-brand-700 text-white"
            >
              {importBusy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
