'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, Eye, FileText, Loader2, RefreshCw, Trash2, Upload } from '@/components/icons';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Requirement, RequirementDetail, RequirementInput, RequirementStatus, TrackerOptions } from '@/lib/types';
import { cn } from '@/lib/utils';
import { JD_ACCEPT, errorText, uploadJdFile } from './jd';
import { useAuthStore } from '@/stores/authStore';
import { DURATION_NUMBERS, DURATION_UNITS, FIELD_LABELS, PersonSelect, RecruitersSelect, StatusPill, StatusSelect, formatDay, formatWhen, todayIso } from './shared';

interface Props {
  /** The requirement being edited; absent when adding a new one */
  requirement?: Requirement | null;
  options: TrackerOptions;
  /** True while the document preview is open above this dialog, so clicks in it do not close this one */
  previewOpen: boolean;
  onPreview: (jdId: string, name: string) => void;
  onClose: () => void;
  onSaved: (saved: Requirement, created: boolean) => void;
}

type Jd = { id: string; name: string } | null;
type DurationType = '' | 'full_time' | 'fixed';
type DurationUnit = (typeof DURATION_UNITS)[number];
const NOT_SET = '__none__';

function historyText(field: string | null, old: string | null, next: string | null): string {
  const label = FIELD_LABELS[field || ''] || field || 'a field';
  const showDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDay(v) : v);
  const short = (v: string | null) => { const t = showDate(v); return t && t.length > 70 ? `${t.slice(0, 70)}...` : t; };
  if (field === 'job_posted') return 'Posted the job in Careers';
  if (old && next) return `${label}: ${short(old)} to ${short(next)}`;
  if (next) return `${label} set to ${short(next)}`;
  return `${label} cleared`;
}

/** The form for adding a requirement (sales manager, managers, EVP, admin) and for changing every field of one. */
export default function RequirementDialog({ requirement, options, previewOpen, onPreview, onClose, onSaved }: Props) {
  const editing = !!requirement;
  const ed = options.editable;          // which fields this person may change: the others are shown, not editable
  const [date, setDate] = useState(requirement?.requirement_date ?? todayIso());
  const [position, setPosition] = useState(requirement?.position ?? '');
  const [client, setClient] = useState(requirement?.client ?? '');
  const [jobLocation, setJobLocation] = useState(requirement?.job_location ?? '');
  const [salary, setSalary] = useState(requirement?.salary ?? '');
  const [durationType, setDurationType] = useState<DurationType>(requirement?.duration_type ?? '');
  const [durationValue, setDurationValue] = useState(requirement?.duration_value ? String(requirement.duration_value) : '');
  const [durationUnit, setDurationUnit] = useState<DurationUnit>(requirement?.duration_unit ?? 'months');
  const [extendable, setExtendable] = useState(requirement?.duration_extendable ?? false);
  const [recruiterIds, setRecruiterIds] = useState<string[]>(requirement?.recruiters?.map((r) => r.id) ?? []);
  const me = useAuthStore((s) => s.user);
  const [managerId, setManagerId] = useState(requirement?.manager?.id ?? '');
  // a sales manager adding a requirement is its sales manager unless they choose another
  const [salesId, setSalesId] = useState(requirement ? requirement.sales_manager?.id ?? '' : me?.role === 'account_manager' ? me.id : '');
  const [cvDate, setCvDate] = useState(requirement?.cv_submission_date ?? '');
  // each recruiter's own CVs submitted: the day and how many
  const [cvs, setCvs] = useState<Record<string, { date: string; count: string }>>(() => Object.fromEntries(
    (requirement?.recruiters ?? []).map((r) => [r.id, { date: r.cvs_submitted_date ?? '', count: r.cvs_submitted_count == null ? '' : String(r.cvs_submitted_count) }])));
  const [status, setStatus] = useState<RequirementStatus>(requirement?.status ?? 'open');
  const [salesComments, setSalesComments] = useState(requirement?.sales_comments ?? '');
  const [rmComments, setRmComments] = useState(requirement?.rm_comments ?? '');
  const [recruiterComments, setRecruiterComments] = useState(requirement?.recruiter_comments ?? '');
  const [jd, setJd] = useState<Jd>(requirement?.jd_id ? { id: requirement.jd_id, name: requirement.jd_filename || 'Job description' } : null);
  const [uploading, setUploading] = useState(false);
  const [jdError, setJdError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RequirementDetail | null>(null);
  const file = useRef<HTMLInputElement>(null);

  // the recruiters this person may assign (the server lists those of their own location; the EVP and the admin get everyone)
  const recruiterOptions = useMemo(() => {
    const list = options.recruiters.map((r) => ({ id: r.id, username: r.username }));
    for (const r of requirement?.recruiters ?? []) if (!list.some((x) => x.id === r.id)) list.push({ id: r.id, username: r.username });   // one who is no longer in the list stays
    return list;
  }, [options.recruiters, requirement]);
  // the recruiters who were already on this requirement and still are: the ones whose CVs submitted can be written here
  const submitters = (requirement?.recruiters ?? []).filter((r) => recruiterIds.includes(r.id));

  useEffect(() => {
    if (!requirement) return;
    let alive = true;
    api.getRequirement(requirement.id).then((d) => { if (alive) setDetail(d); }).catch(() => undefined);
    return () => { alive = false; };
  }, [requirement]);

  const pick = async (f: File | undefined | null) => {
    if (!f) return;
    setJdError(null);
    setUploading(true);
    try {
      setJd(await uploadJdFile(f));
    } catch (e) {
      setJdError(errorText(e, 'The job description could not be uploaded.'));
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };

  /** The four duration fields for what is chosen: nothing, full time (no number or unit), or a fixed period. */
  const durationFields = (): Pick<RequirementInput, 'duration_type' | 'duration_value' | 'duration_unit' | 'duration_extendable'> =>
    durationType === 'fixed'
      ? { duration_type: 'fixed', duration_value: Number(durationValue), duration_unit: durationUnit, duration_extendable: extendable }
      : durationType === 'full_time'
        ? { duration_type: 'full_time', duration_value: null, duration_unit: null, duration_extendable: null }
        : { duration_type: null, duration_value: null, duration_unit: null, duration_extendable: null };

  const save = async () => {
    setError(null);
    if (!position.trim() || !client.trim()) { setError('Position and client are required.'); return; }
    if (!date) { setError('The requirement date is required.'); return; }
    if (cvDate && cvDate < date) { setError('The submission deadline date cannot be before the requirement date.'); return; }
    for (const r of submitters) {
      const row = cvs[r.id];
      if (!row) continue;
      if (row.date && row.date < date) { setError(`CVs cannot have been submitted before the requirement date (${r.username}).`); return; }
      if (row.count.trim() !== '' && !/^\d{1,6}$/.test(row.count.trim())) { setError(`The number of CVs submitted by ${r.username} must be a whole number, 0 or more.`); return; }
    }
    if (ed.duration && durationType === 'fixed' && !durationValue) { setError('Choose how many days, months or years the job lasts, or pick Full time.'); return; }
    if (uploading) return;

    const next: RequirementInput = {
      requirement_date: date,
      position: position.trim(),
      client: client.trim(),
      job_location: jobLocation.trim() || null,
      salary: salary.trim() || null,
      ...(ed.duration ? durationFields() : {}),
      jd_id: jd?.id ?? null,
      cv_submission_date: cvDate || null,
      recruiter_ids: recruiterIds,
      ...(ed.recruitment_manager && managerId ? { manager_id: managerId } : {}),
      ...(ed.sales_manager && salesId ? { sales_manager_id: salesId } : {}),
      // each comment, and the status, is sent only by the role that owns it
      ...(ed.sales_comments ? { sales_comments: salesComments.trim() || null } : {}),
      ...(ed.rm_comments ? { rm_comments: rmComments.trim() || null } : {}),
      ...(ed.status ? { status } : {}),
    };
    setSaving(true);
    try {
      if (!requirement) {
        onSaved(await api.createRequirement(next), true);
      } else {
        // only what changed is sent, so a field someone else changed meanwhile is not overwritten
        const body: RequirementInput = {};
        const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
        if (!same(next.requirement_date, requirement.requirement_date)) body.requirement_date = next.requirement_date;
        if (!same(next.position, requirement.position)) body.position = next.position;
        if (!same(next.client, requirement.client)) body.client = next.client;
        if (!same(next.job_location, requirement.job_location)) body.job_location = next.job_location;
        if (!same(next.salary, requirement.salary)) body.salary = next.salary;
        if (ed.cvs_submitted) {
          const entries = submitters.flatMap((r) => {
            const row = cvs[r.id];
            if (!row) return [];
            const item: { recruiter_id: string; date?: string | null; count?: number | null } = { recruiter_id: r.id };
            const count = row.count.trim() === '' ? null : Number(row.count);
            if (!same(row.date || null, r.cvs_submitted_date)) item.date = row.date || null;
            if (!same(count, r.cvs_submitted_count)) item.count = count;
            return 'date' in item || 'count' in item ? [item] : [];
          });
          if (entries.length) body.cvs_submissions = entries;
        }
        if (ed.duration) {
          const key = (t: unknown, v: unknown, u: unknown, e: unknown) => `${t ?? ''}|${v ?? ''}|${u ?? ''}|${e ?? ''}`;
          if (key(requirement.duration_type, requirement.duration_value, requirement.duration_unit, requirement.duration_extendable)
            !== key(next.duration_type, next.duration_value, next.duration_unit, next.duration_extendable)) Object.assign(body, durationFields());
        }
        if (!same(next.jd_id, requirement.jd_id)) body.jd_id = next.jd_id;
        if (ed.sales_comments && !same(next.sales_comments, requirement.sales_comments)) body.sales_comments = next.sales_comments;
        if (ed.rm_comments && !same(next.rm_comments, requirement.rm_comments)) body.rm_comments = next.rm_comments;
        const rc = recruiterComments.trim() || null;
        if (ed.recruiter_comments && !same(rc, requirement.recruiter_comments)) body.recruiter_comments = rc;
        if (!same(next.cv_submission_date, requirement.cv_submission_date)) body.cv_submission_date = next.cv_submission_date;
        const before = requirement.recruiters.map((r) => r.id);
        if (before.length !== recruiterIds.length || before.some((id, i) => id !== recruiterIds[i])) body.recruiter_ids = recruiterIds;
        if (ed.recruitment_manager && !same(managerId || null, requirement.manager?.id)) body.manager_id = managerId || null;
        if (ed.sales_manager && !same(salesId || null, requirement.sales_manager?.id)) body.sales_manager_id = salesId || null;
        if (ed.status && next.status !== requirement.status) body.status = next.status;
        if (Object.keys(body).length === 0) { onClose(); return; }
        onSaved(await api.updateRequirement(requirement.id, body), false);
      }
    } catch (e) {
      setError(errorText(e, 'The requirement could not be saved. Please try again.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent
        className="max-h-[92vh] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
        onInteractOutside={(e) => { if (previewOpen || saving) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (previewOpen || saving) e.preventDefault(); }}
      >
        <DialogHeader className="border-b border-surface-border px-6 py-4">
          <DialogTitle>{editing ? 'Edit requirement' : 'New requirement'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Change the details. Each comment is written by its own role, and every change is kept in the history below.' : 'Record a requirement received from a client. The recruiter can be assigned now or later.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Requirement date" required htmlFor="rq-date">
              <Input id="rq-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} min="2000-01-01" max="2100-12-31" />
            </Field>
            <Field label="Submission deadline date" htmlFor="rq-cv" hint="When CVs are due to the client">
              <Input id="rq-cv" type="date" value={cvDate} onChange={(e) => setCvDate(e.target.value)} min={date || undefined} max="2100-12-31" />
            </Field>
            <Field label="Position" required htmlFor="rq-position">
              <Input id="rq-position" value={position} onChange={(e) => setPosition(e.target.value)} maxLength={160} placeholder="Senior Network Engineer" autoFocus={!editing} />
            </Field>
            <Field label="Client" required htmlFor="rq-client">
              <Input id="rq-client" value={client} onChange={(e) => setClient(e.target.value)} maxLength={160} placeholder="Client name" />
            </Field>

            <Field label="Job location" htmlFor="rq-jobloc" hint="Where the job is">
              <Input id="rq-jobloc" value={jobLocation} onChange={(e) => setJobLocation(e.target.value)} maxLength={160} placeholder="Dubai, UAE" disabled={!ed.job_location} />
            </Field>
            <Field label="Salary" htmlFor="rq-salary" hint="As the client gives it">
              <Input id="rq-salary" value={salary} onChange={(e) => setSalary(e.target.value)} maxLength={64} placeholder="12,000 - 15,000 AED" disabled={!ed.salary} />
            </Field>
            <Field label="Job duration" className="sm:col-span-2" hint={durationType === 'fixed' ? 'A number of days, months or years, and whether it may be extended' : 'Full time has no end date'}>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={durationType || NOT_SET} onValueChange={(v) => setDurationType(v === NOT_SET ? '' : (v as DurationType))} disabled={!ed.duration}>
                  <SelectTrigger aria-label="Job duration" className="h-9 w-[11rem]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_SET}>Not specified</SelectItem>
                    <SelectItem value="full_time">Full time</SelectItem>
                    <SelectItem value="fixed">Contract</SelectItem>
                  </SelectContent>
                </Select>
                {durationType === 'fixed' && (
                  <>
                    <Select value={durationValue || undefined} onValueChange={setDurationValue} disabled={!ed.duration}>
                      <SelectTrigger aria-label="Number of days, months or years" className="h-9 w-[6.5rem]"><SelectValue placeholder="Number" /></SelectTrigger>
                      <SelectContent className="max-h-64">{DURATION_NUMBERS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={durationUnit} onValueChange={(v) => setDurationUnit(v as DurationUnit)} disabled={!ed.duration}>
                      <SelectTrigger aria-label="Days, months or years" className="h-9 w-[7.5rem]"><SelectValue /></SelectTrigger>
                      <SelectContent>{DURATION_UNITS.map((u) => <SelectItem key={u} value={u}>{u[0].toUpperCase() + u.slice(1)}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={extendable ? 'yes' : 'no'} onValueChange={(v) => setExtendable(v === 'yes')} disabled={!ed.duration}>
                      <SelectTrigger aria-label="Extendable or not" className="h-9 w-[10.5rem]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">Extendable</SelectItem>
                        <SelectItem value="no">Not extendable</SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>
            </Field>
            <Field label="Assigned recruiters" hint={recruiterOptions.length === 0 ? 'No recruiters to assign yet' : 'Tick everyone who works on it. The first is the lead.'}>
              <RecruitersSelect inline value={recruiterIds} options={recruiterOptions} onChange={setRecruiterIds} className="h-9 w-full text-sm" />
            </Field>
            <Field label="Recruitment manager" hint={ed.recruitment_manager ? 'Which recruitment manager looks after it' : 'Chosen by a manager, the sales manager, the EVP or the admin'}>
              <PersonSelect label="Recruitment manager" className="h-9 w-full text-sm" value={managerId} current={requirement?.manager} people={options.managers ?? []} onChange={(id) => setManagerId(id ?? '')} disabled={!ed.recruitment_manager} />
            </Field>
            <Field label="Sales manager" hint={ed.sales_manager ? 'Which sales manager owns it' : 'Chosen by a manager, the sales manager, the EVP or the admin'}>
              <PersonSelect label="Sales manager" className="h-9 w-full text-sm" value={salesId} current={requirement?.sales_manager} people={options.sales_managers ?? []} onChange={(id) => setSalesId(id ?? '')} disabled={!ed.sales_manager} />
            </Field>

            {(editing || ed.status) && (
              <Field label="Status" hint={ed.status ? undefined : 'Changed by the recruiter and the recruitment manager'}>
                {ed.status ? <StatusSelect value={status} onChange={setStatus} /> : <div><StatusPill status={status} /></div>}
              </Field>
            )}

            {editing && (
              <div className="space-y-2 sm:col-span-2">
                <p className="text-xs font-semibold text-slate-700">CVs submitted by each recruiter</p>
                {submitters.length === 0 ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">Nobody is assigned yet. Once a recruiter is on this requirement, the day they submitted CVs and how many appear here.</p>
                ) : (
                  <ul className="space-y-2">
                    {submitters.map((r, i) => {
                      const row = cvs[r.id] ?? { date: '', count: '' };
                      return (
                        <li key={r.id} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_7rem]">
                          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800">
                            <span className="truncate">{r.username}</span>
                            {i === 0 && <span className="rounded bg-navy-50 px-1.5 py-0.5 text-2xs font-semibold text-navy-800">Lead</span>}
                          </span>
                          <Input type="date" aria-label={`CVs submitted on, ${r.username}`} value={row.date} min={date || undefined} max="2100-12-31" disabled={!ed.cvs_submitted}
                                 onChange={(e) => setCvs((c) => ({ ...c, [r.id]: { ...row, date: e.target.value } }))} />
                          <Input type="number" aria-label={`Number of CVs submitted, ${r.username}`} min={0} max={100000} step={1} inputMode="numeric" placeholder="0" value={row.count} disabled={!ed.cvs_submitted}
                                 onChange={(e) => setCvs((c) => ({ ...c, [r.id]: { ...row, count: e.target.value } }))} />
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="text-xs text-slate-500">{ed.cvs_submitted ? 'The recruiters write their own in the table. You can correct them here.' : 'Written by the recruiters.'}</p>
              </div>
            )}
          </div>

          {/* the job description: stored in the JD library */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">Job description</p>
            <input ref={file} type="file" accept={JD_ACCEPT} className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
            {editing && requirement?.jd_id && requirement.job_id && jd?.id !== requirement.jd_id && (
              <p role="note" className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Saving deactivates the job posted from the current description in Careers, so it takes no new applications. Nothing is deleted: the description, the job and its applications stay.
              </p>
            )}
            {uploading ? (
              <div className="flex items-center gap-3 rounded-xl border border-navy-100 bg-navy-50/60 px-4 py-3.5 text-sm text-navy-900" role="status">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading the job description and saving it to the JD library. This takes a few seconds.
              </div>
            ) : jd ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3">
                <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{jd.name}</p>
                  <p className="text-xs text-slate-500">Saved in the JD library</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="secondary" size="sm" icon={<Eye />} onClick={() => onPreview(jd.id, jd.name)}>Preview</Button>
                  {ed.jd && <Button variant="secondary" size="sm" icon={<RefreshCw />} onClick={() => file.current?.click()}>Replace</Button>}
                  {ed.jd && <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => setJd(null)} aria-label="Remove the job description">Remove</Button>}
                </div>
              </div>
            ) : !ed.jd ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">No job description. It is uploaded by the sales manager or the recruitment manager.</p>
            ) : (
              <button
                type="button"
                onClick={() => file.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files?.[0]); }}
                className="flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition-colors hover:border-navy-300 hover:bg-navy-50/40"
              >
                <Upload className="h-5 w-5 text-navy-700" />
                <span className="text-sm font-semibold text-slate-800">Upload the job description</span>
                <span className="text-xs text-slate-500">PDF, Word or text, up to 5 MB. You can preview it once it is uploaded.</span>
              </button>
            )}
            {jdError && <p role="alert" className="flex items-start gap-1.5 text-xs text-red-600"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {jdError}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sales manager comments" htmlFor="rq-sales" hint={ed.sales_comments ? 'Optional' : 'Written by the sales manager'}>
              <Textarea id="rq-sales" value={salesComments} onChange={(e) => setSalesComments(e.target.value)} maxLength={4000} rows={3} disabled={!ed.sales_comments} />
            </Field>
            <Field label="Recruitment manager comments" htmlFor="rq-rm" hint={ed.rm_comments ? 'Optional' : 'Written by the recruitment manager'}>
              <Textarea id="rq-rm" value={rmComments} onChange={(e) => setRmComments(e.target.value)} maxLength={4000} rows={3} disabled={!ed.rm_comments} />
            </Field>
            {editing && (
              <Field label="Recruiter comments" htmlFor="rq-rc" hint={ed.recruiter_comments ? 'Optional. Shown to everyone who can see this requirement.' : 'Written by the recruiter'} className="sm:col-span-2">
                <Textarea id="rq-rc" value={recruiterComments} onChange={(e) => setRecruiterComments(e.target.value)} maxLength={4000} rows={2} disabled={!ed.recruiter_comments} />
              </Field>
            )}
          </div>

          {editing && (
            <div className="space-y-2 border-t border-surface-border pt-4">
              <p className="text-xs font-semibold text-slate-700">History</p>
              {!detail ? (
                <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...</p>
              ) : detail.history.length === 0 ? (
                <p className="text-xs text-slate-500">Nothing yet.</p>
              ) : (
                <ol className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {detail.history.map((h, i) => (
                    <li key={i} className="flex gap-2.5 text-xs">
                      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', h.action === 'created' ? 'bg-emerald-500' : 'bg-navy-500')} />
                      <span className="min-w-0 text-slate-700">
                        <span className="font-semibold text-slate-900">{h.actor}</span>{' '}
                        {h.action === 'created' ? 'added the requirement' : historyText(h.field, h.old, h.new)}
                        <span className="block text-2xs text-slate-400">{formatWhen(h.at)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={uploading || saving}>
            {editing ? 'Save changes' : 'Add requirement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
