'use client';

import { useState } from 'react';
import { Download } from '@/components/icons';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function toYmd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Text a person typed (a job title, a recruiter name) made safe to put inside the report's HTML. */
function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function downloadWordHtml(filename: string, html: string) {
  const blob = new Blob([`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Admin: a Word report of recruiting activity (jobs posted, by whom, applications per job) for a chosen date range. */
export default function WeeklyReportDialog({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return toYmd(start);
  });
  const [to, setTo] = useState(() => toYmd(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.getWeeklyAnalysisReport({ startDate: from, endDate: to });
      const recruiters = r.recruiters_posted.map((x, i) => `${i + 1}. ${esc(x.recruiter)} – ${x.jobs_posted}`).join('<br/>');
      const appsByRecruiter = Object.entries(r.applications_by_recruiter)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([recruiter, jobs], idx) => {
          const jobsHtml = jobs.map((j, jIdx) => `${String.fromCharCode(97 + (jIdx % 26))}. ${esc(j.job_title)} – ${j.applications}`).join('<br/>');
          return `${idx + 1}. <b>${esc(recruiter)}</b><br/>${jobsHtml}`;
        })
        .join('<br/><br/>');
      const html = `
        <div style="font-family:Calibri, Arial, sans-serif; font-size:11pt;">
          <div style="font-weight:700; font-size:16pt;">Alpha CV – weekly Analysis Report</div>
          <div style="margin-top:4px; font-size:11pt;">(Date: ${r.range.start_date} – ${r.range.end_date})</div>
          <div style="margin-top:16px;"><div><b>1. How many total jobs posted?</b></div><div>Total jobs posted – ${r.total_jobs_posted}</div></div>
          <div style="margin-top:14px;"><div><b>2. Which Recruiters Posted?</b></div><div style="margin-top:6px;">${recruiters || '-'}</div></div>
          <div style="margin-top:14px;"><div><b>3. How many applications got for each job?</b></div><div style="margin-top:6px;">${appsByRecruiter || '-'}</div></div>
          <div style="margin-top:14px;"><div><b>4. Any selections?</b></div><div style="margin-top:6px;">-</div></div>
        </div>`;
      downloadWordHtml(`weekly_analysis_report_${r.range.start_date}_to_${r.range.end_date}.doc`, html);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'The report could not be created. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Weekly analysis report</DialogTitle>
          <DialogDescription>A Word document: jobs posted, who posted them and applications per job, for the dates you choose.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-600">
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="field-input mt-1 w-full" />
          </label>
          <label className="text-xs font-medium text-slate-600">
            To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="field-input mt-1 w-full" />
          </label>
        </div>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={<Download className="h-4 w-4" />} disabled={!from || !to} loading={busy} onClick={download}>Download report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
