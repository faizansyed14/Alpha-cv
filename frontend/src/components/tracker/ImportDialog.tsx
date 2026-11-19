'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle, Download, FileText, Upload } from '@/components/icons';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { RequirementImportResult, RequirementImportRow, RequirementStatus, SelectionImportResult, SelectionImportRow } from '@/lib/types';
import { errorText } from './jd';
import { StatusPill, formatDay } from './shared';

const PREVIEW_PAGE = 500;

type Kind = 'requirements' | 'selections';
type Row = RequirementImportRow | SelectionImportRow;
type Result = RequirementImportResult | SelectionImportResult;
type Template = { columns: string[]; optional: string[]; example_rows: (string | number)[][] };
type BadgeVariant = 'success' | 'secondary' | 'danger' | 'info';

const SELECTION_STATUS: Record<string, string> = { offer_pending: 'Offer Pending', offer_released: 'Offer Released', joined: 'Joined', backed_out: 'Backed Out' };

/** What differs between the two imports: the endpoints, the words, the numbers and the table. */
const CONFIG: Record<Kind, {
  title: string;
  run: (file: File, apply: boolean) => Promise<Result>;
  columns: () => Promise<Template>;
  template: () => Promise<Blob>;
  templateName: string;
  hints: string[];
  outcome: Record<string, { label: string; variant: BadgeVariant }>;
  boxes: (r: Result) => { label: string; n: number; good?: boolean; bad?: boolean }[];
  importable: (r: Result) => number;
  noun: [string, string];
  head: string[];
  cells: (r: Row, person: (name: string | null) => ReactNode) => ReactNode[];
}> = {
  requirements: {
    title: 'Import requirements from Excel',
    run: (f, a) => api.importRequirements(f, a),
    columns: () => api.getRequirementImportColumns(),
    template: () => api.downloadRequirementImportTemplate(),
    templateName: 'requirements-import-template.xlsx',
    hints: [
      'Dates as 2026-10-05 or 05/10/2026. Status: Open, Submitted, Hold, Closed or Canceled.',
      'Several recruiters in one cell: separate them with a comma. Comments become the recruiter comments.',
      'A closed requirement also gets its row on Selections & joining.',
      'A row already in the tracker (same role, client and requirement date) is skipped, so the same file can be imported again.',
    ],
    outcome: {
      import: { label: 'Will import', variant: 'success' },
      exists: { label: 'Already there, skipped', variant: 'secondary' },
      error: { label: 'Not imported', variant: 'danger' },
    },
    boxes: (r) => {
      const s = (r as RequirementImportResult).summary;
      return [{ label: 'Will be imported', n: s.import, good: true }, { label: 'Already there, skipped', n: s.exists }, { label: 'Cannot be imported', n: s.error, bad: true }];
    },
    importable: (r) => (r as RequirementImportResult).summary.import,
    noun: ['requirement', 'requirements'],
    head: ['Role', 'Client', 'Recruiter', 'Manager', 'Sales', 'Date', 'CVs', 'Status'],
    cells: (row, person) => {
      const r = row as RequirementImportRow;
      return [
        <span key="p" className="font-medium text-slate-900">{r.position || '-'}</span>, r.client || '-',
        r.sheet.recruiters.length ? r.sheet.recruiters.map((n, i) => <span key={n}>{i > 0 && ', '}{person(n)}</span>) : person(null),
        person(r.sheet.manager), person(r.sheet.sales_manager),
        <span key="d" className="whitespace-nowrap tabular-nums">{r.requirement_date ? formatDay(r.requirement_date) : '-'}</span>,
        <span key="c" className="tabular-nums">{r.cvs_submitted_count ?? '-'}</span>,
        r.status ? <StatusPill key="s" status={r.status as RequirementStatus} /> : '-',
      ];
    },
  },
  selections: {
    title: 'Import selections & joining from Excel',
    run: (f, a) => api.importSelections(f, a),
    columns: () => api.getSelectionImportColumns(),
    template: () => api.downloadSelectionImportTemplate(),
    templateName: 'selections-import-template.xlsx',
    hints: [
      'Dates as 2026-11-03 or 03/11/2026. Status: Offer Pending, Offer Released, Joined or Backed Out.',
      'A closed requirement\'s empty row (same position and client) gets the candidate; otherwise a new row is added.',
      'A candidate already on this page (same name, position and client) is skipped and the existing row is not changed.',
    ],
    outcome: {
      new: { label: 'New row', variant: 'success' },
      fill: { label: 'Into closed requirement', variant: 'info' },
      exists: { label: 'Already there, skipped', variant: 'secondary' },
      error: { label: 'Not imported', variant: 'danger' },
    },
    boxes: (r) => {
      const s = (r as SelectionImportResult).summary;
      return [{ label: 'New rows', n: s.new, good: true }, { label: 'Into closed requirements', n: s.fill, good: true },
              { label: 'Already there, skipped', n: s.exists }, { label: 'Cannot be imported', n: s.error, bad: true }];
    },
    importable: (r) => (r as SelectionImportResult).summary.new + (r as SelectionImportResult).summary.fill,
    noun: ['selection', 'selections'],
    head: ['Date', 'Candidate', 'Position', 'Client', 'Recruiter', 'Account manager', 'Recruitment manager', 'Status'],
    cells: (row, person) => {
      const r = row as SelectionImportRow;
      return [
        <span key="d" className="whitespace-nowrap tabular-nums">{r.date ? formatDay(r.date) : '-'}</span>,
        <span key="n" className="font-medium text-slate-900">{r.candidate_name || '-'}</span>, r.position || '-', r.client || '-',
        r.sheet.recruiters.length ? r.sheet.recruiters.map((n, i) => <span key={n}>{i > 0 && ', '}{person(n)}</span>) : person(null),
        person(r.sheet.sales_manager), person(r.sheet.manager),
        r.status ? SELECTION_STATUS[r.status] ?? r.status : '-',
      ];
    },
  },
};

/**
 * Import a sheet into the requirements tracker or Selections & joining. It opens on the exact column names and an example; choosing a file
 * only CHECKS it and lists every row with what will happen to it. Nothing is added until "Import" is clicked, and a row that is already
 * there is skipped, so the same file can be imported again.
 */
export default function ImportDialog({ kind = 'requirements', onClose, onImported }: { kind?: Kind; onClose: () => void; onImported: (created: number) => void }) {
  const c = CONFIG[kind];
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [show, setShow] = useState<'all' | 'error' | 'notes'>('all');
  // a 10,000-row sheet is listed 500 rows at a time: the page stays quick (every row is still imported)
  const [shown, setShown] = useState(PREVIEW_PAGE);
  useEffect(() => { setShown(PREVIEW_PAGE); }, [show, result]);
  const [template, setTemplate] = useState<Template | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    c.columns().then(setTemplate).catch(() => setTemplate(null));
  }, [c]);

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      const url = URL.createObjectURL(await c.template());
      const a = document.createElement('a');
      a.href = url;
      a.download = c.templateName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setProblem(errorText(e, 'The template could not be downloaded.'));
    } finally {
      setDownloading(false);
    }
  };

  const check = async (f: File) => {
    setFile(f);
    setResult(null);
    setProblem(null);
    setShow('all');
    setBusy('check');
    try {
      setResult(await c.run(f, false));
    } catch (e) {
      setProblem(errorText(e, 'The file could not be read.'));
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    if (!file) return;
    setBusy('import');
    setProblem(null);
    try {
      onImported((await c.run(file, true)).created);
    } catch (e) {
      setProblem(errorText(e, 'The import failed. Nothing was added.'));
      setBusy(null);
    }
  };

  const s = result?.summary;
  const n = result ? c.importable(result) : 0;
  const rows = ((result?.rows ?? []) as Row[]).filter((r) => show === 'all' || (show === 'error' ? r.outcome === 'error' : r.notes.length > 0));

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-6xl p-0">
        <DialogHeader className="border-b border-surface-border px-6 py-4">
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>
            The first row of the sheet must have exactly these column names. A sheet with a missing, misspelt or extra column is rejected.
            People are matched to logins by name. Nothing is added until you click Import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-4">
          {!result && template && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="section-label">The sheet must look like this</p>
                <Button variant="secondary" size="sm" icon={<Download />} onClick={() => void downloadTemplate()} loading={downloading}>Download template</Button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="w-8 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5" />
                      {[...template.optional, ...template.columns].map((col, i) => (
                        <th key={col} className="border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-medium text-slate-400">{String.fromCharCode(65 + i)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-slate-400">1</td>
                      {[...template.optional, ...template.columns].map((col) => (
                        <td key={col} className="whitespace-nowrap border-b border-r border-slate-200 bg-navy-50 px-2 py-1.5 font-semibold text-navy-900">
                          {col}{template.optional.includes(col) && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
                        </td>
                      ))}
                    </tr>
                    {template.example_rows.map((r, i) => (
                      <tr key={i}>
                        <td className="border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-slate-400">{i + 2}</td>
                        {r.map((v, j) => <td key={j} className="whitespace-nowrap border-b border-r border-slate-200 px-2 py-1.5 text-slate-600">{String(v)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-slate-500">{c.hints.map((h) => <li key={h}>{h}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void check(f); e.target.value = ''; }} />
            <Button variant="secondary" size="sm" icon={<Upload />} onClick={() => input.current?.click()} loading={busy === 'check'} disabled={!!busy}>
              {file ? 'Choose another file' : 'Choose Excel file'}
            </Button>
            {file && <span className="inline-flex items-center gap-1.5 text-sm text-slate-600"><FileText className="h-4 w-4 text-slate-400" />{file.name}</span>}
          </div>

          {problem && <p role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{problem}</p>}

          {result && s && (
            <>
              <div className={`grid gap-3 ${c.boxes(result).length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
                {c.boxes(result).map((b) => (
                  <div key={b.label} className="rounded-xl border border-surface-border bg-paper px-4 py-3 shadow-soft">
                    <p className="text-xs font-medium text-slate-500">{b.label}</p>
                    <p className={`mt-1 text-2xl font-semibold tabular-nums ${b.bad && b.n ? 'text-red-700' : b.good && b.n ? 'text-emerald-700' : 'text-slate-700'}`}>
                      {b.n}<span className="ml-1 text-sm font-normal text-slate-400">of {s.rows}</span>
                    </p>
                  </div>
                ))}
              </div>

              {result.missing_logins.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                  <p className="text-sm font-semibold text-slate-900">Create these logins first</p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    These names in the sheet have no login with that role. Add them on the Users page (username like the name, all in the same
                    location), then choose the file again.
                  </p>
                  <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {result.missing_logins.map((m) => (
                      <div key={`${m.role}|${m.name}`} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-paper px-3 py-1.5 text-sm">
                        <span className="min-w-0 truncate"><span className="font-medium text-slate-900">{m.name}</span><span className="text-slate-500"> · {m.role}</span></span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-500">{m.rows} row{m.rows === 1 ? '' : 's'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1">
                {(['all', 'error', 'notes'] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setShow(k)}
                          className={`rounded-md px-2.5 py-1 text-xs font-semibold ${show === k ? 'bg-navy-50 text-navy-800' : 'text-slate-500 hover:bg-slate-50'}`}>
                    {k === 'all' ? `All rows (${s.rows})` : k === 'error' ? `Cannot be imported (${s.error})` : `Adjusted (${s.with_notes})`}
                  </button>
                ))}
              </div>

              <div className="max-h-[45vh] overflow-auto rounded-xl border border-slate-200">
                <Table>
                  <THead>
                    <TR><TH>Row</TH>{c.head.map((h) => <TH key={h}>{h}</TH>)}<TH>Result</TH></TR>
                  </THead>
                  <TBody>
                    {rows.slice(0, shown).map((r) => {
                      const missingNames = new Set(r.missing.map((m) => m.name));
                      const person = (name: string | null) => !name ? <span className="text-slate-300">-</span>
                        : missingNames.has(name) ? <span className="text-red-700 underline decoration-dotted underline-offset-2" title="No login with this name">{name}</span>
                        : <span>{name}</span>;
                      const other = r.problems.filter((p) => !p.includes('no active login'));
                      const o = c.outcome[r.outcome];
                      return (
                        <TR key={r.row} className="align-top">
                          <TD className="tabular-nums text-slate-400">{r.row}</TD>
                          {c.cells(r, person).map((cell, i) => <TD key={i}>{cell}</TD>)}
                          <TD className="min-w-[13rem]">
                            <Badge variant={o.variant}>{o.label}</Badge>
                            {r.missing.length > 0 && <p className="mt-1 text-xs text-red-700">No login: {Array.from(missingNames).join(', ')}</p>}
                            {other.map((p, i) => <p key={`p${i}`} className="mt-1 text-xs text-red-700">{p}</p>)}
                            {r.notes.map((t, i) => <p key={`n${i}`} className="mt-1 text-xs text-slate-500">{t}</p>)}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
              {rows.length > shown && (
                <div className="mt-3 flex items-center justify-center gap-3 text-xs text-slate-500">
                  <span className="tabular-nums">Showing {shown.toLocaleString()} of {rows.length.toLocaleString()} rows</span>
                  <Button variant="secondary" size="sm" onClick={() => setShown((n) => n + PREVIEW_PAGE)}>
                    Show {Math.min(PREVIEW_PAGE, rows.length - shown).toLocaleString()} more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="border-t border-surface-border px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={!!busy}>Cancel</Button>
          <Button variant="primary" icon={<CheckCircle />} onClick={() => void doImport()} loading={busy === 'import'} disabled={!result || n === 0 || !!busy}>
            {result ? `Import ${n} ${n === 1 ? c.noun[0] : c.noun[1]}` : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
