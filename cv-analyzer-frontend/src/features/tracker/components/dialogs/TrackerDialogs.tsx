'use client';

import { useEffect, useState } from 'react';
import { trackerApi, type TrackerTeam } from '@/lib/trackerApi';
import { useAuthStore } from '@/stores/authStore';
import type { TrackerApplication, TrackerCandidate, TrackerFollowUp, TrackerJobOpening, TrackerOption } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { ManagedSelect } from '@/components/tracker/ManagedSelect';
import { Loader2, Plus, Save } from 'lucide-react';
import { FieldRow, FormInput, DatePicker } from '../FormFields';
import { FOLLOW_UP_STAGE_OPTIONS } from '../../types';

export function EditJobOpeningDialog({
  job,
  onClose,
  onSaved,
  team,
  jobStatusOptions,
  requirementOptions,
  recruiterOptions,
  accountManagerOptions,
  recruitmentManagerOptions,
  canManageOptions,
  onAddOption,
  onEditOption,
  onDeleteOption,
}: {
  job: TrackerJobOpening | null;
  onClose: () => void;
  onSaved: () => void;
  team?: TrackerTeam;
  jobStatusOptions: TrackerOption[];
  requirementOptions: TrackerOption[];
  recruiterOptions: TrackerOption[];
  accountManagerOptions: TrackerOption[];
  recruitmentManagerOptions: TrackerOption[];
  canManageOptions: boolean;
  onAddOption: (kind: string, value: string) => Promise<void>;
  onEditOption: (kind: string, id: string, value: string) => Promise<void>;
  onDeleteOption: (kind: string, id: string) => Promise<void>;
}) {
  const { token } = useAuthStore();
  const [reqDate, setReqDate] = useState('');
  const [role, setRole] = useState('');
  const [client, setClient] = useState('');
  const [recruiter, setRecruiter] = useState('');
  const [recruitmentManager, setRecruitmentManager] = useState('');
  const [accountManager, setAccountManager] = useState('');
  const [status, setStatus] = useState('Open');
  const [requirement, setRequirement] = useState('');
  const [submissionDate, setSubmissionDate] = useState('');
  const [cvsSubmittedCount, setCvsSubmittedCount] = useState<string>('');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!job) return;
    setReqDate(job.req_date ? String(job.req_date) : '');
    setRole(job.title || '');
    setClient(job.client || '');
    setRecruiter(job.hiring_manager || '');
    setRecruitmentManager((job as any).recruitment_manager || '');
    setAccountManager(job.department || '');
    setStatus(job.status || 'Open');
    setRequirement(String((job as any).requirement || ''));
    setSubmissionDate(String((job as any).submission_date || ''));
    setCvsSubmittedCount(
      (job as any).cvs_submitted_count !== undefined && (job as any).cvs_submitted_count !== null
        ? String((job as any).cvs_submitted_count)
        : ''
    );
    setComments(String((job as any).comments || ''));
  }, [job]);

  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg animate-page-enter border-slate-200 bg-white text-slate-900 shadow-[var(--shadow-md)]">
        <DialogHeader>
          <DialogTitle className="text-slate-900">Edit Requirement</DialogTitle>
          <DialogDescription>Update fields for this requirement.</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto max-h-[70vh] pr-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <FieldRow label="Requirement date"><DatePicker value={reqDate} onChange={setReqDate} label="Requirement date" /></FieldRow>
            <FieldRow label="Submission date"><DatePicker value={submissionDate} onChange={setSubmissionDate} label="Submission date" /></FieldRow>
            <div className="sm:col-span-2"><FieldRow label="Role"><FormInput value={role} onChange={setRole} placeholder="e.g. DevOps Engineer" /></FieldRow></div>
            <FieldRow label="Client"><FormInput value={client} onChange={setClient} placeholder="e.g. FinEdge" /></FieldRow>
            <div className="sm:col-span-2 flex gap-4">
              <div className="w-1/3">
                <FieldRow label="No. of CVs">
                  <FormInput
                    value={cvsSubmittedCount}
                    onChange={(v) => setCvsSubmittedCount(v.replace(/[^\d]/g, '').slice(0, 6))}
                    placeholder="e.g. 12"
                  />
                </FieldRow>
              </div>
              <div className="flex-1">
                <FieldRow label="Status">
                  <ManagedSelect
                    label="Status"
                    value={status}
                    canManage={false}
                    options={jobStatusOptions.map((o) => ({ id: o.id, value: o.value }))}
                    onChange={setStatus}
                    onAdd={async () => { }}
                    onEdit={async () => { }}
                    onDelete={async () => { }}
                  />
                </FieldRow>
              </div>
            </div>
            <FieldRow label="Recruiter">
              <ManagedSelect
                label="Recruiter"
                value={recruiter}
                canManage={false}
                options={recruiterOptions.map((o) => ({ id: o.id, value: o.value }))}
                onChange={setRecruiter}
                onAdd={async () => { }}
                onEdit={async () => { }}
                onDelete={async () => { }}
              />
            </FieldRow>
            <FieldRow label="Recruitment Manager">
              <ManagedSelect
                label="Recruitment Manager"
                value={recruitmentManager}
                canManage={false}
                options={recruitmentManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
                onChange={setRecruitmentManager}
                onAdd={async () => { }}
                onEdit={async () => { }}
                onDelete={async () => { }}
              />
            </FieldRow>
            <FieldRow label="Account Manager">
              <ManagedSelect
                label="Account Manager"
                value={accountManager}
                canManage={false}
                options={accountManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
                onChange={setAccountManager}
                onAdd={async () => { }}
                onEdit={async () => { }}
                onDelete={async () => { }}
              />
            </FieldRow>
            <div className="sm:col-span-2">
              <FieldRow label="Comments">
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  className="w-full min-h-[120px] resize-y text-[13px] text-slate-900 border border-slate-200 rounded-lg p-3 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  placeholder="Comments..."
                />
              </FieldRow>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 bg-white">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!token || !job || !role.trim() || saving}
            onClick={async () => {
              if (!token || !job) return; setSaving(true);
              try {
                await trackerApi.updateJobOpening(token, job.id, {
                  title: role.trim(),
                  requirement: requirement.trim() || null,
                  client: client.trim() || undefined,
                  status,
                  hiring_manager: recruiter.trim() || undefined,
                  recruitment_manager: recruitmentManager.trim() || undefined,
                  department: accountManager.trim() || undefined,
                  req_date: reqDate || null,
                  submission_date: submissionDate || null,
                  cvs_submitted_count: cvsSubmittedCount ? Number(cvsSubmittedCount) : null,
                  comments: comments.trim() || null,
                } as any, team);
                onSaved(); onClose();
              } finally { setSaving(false); }
            }}
            className="bg-brand-600 text-white hover:bg-brand-700"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2 text-white" /> : <Save className="w-4 h-4 mr-2 text-white" />}
            <span className="text-white">Save changes</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditApplicationDialog({
  app,
  cand,
  onClose,
  onSaved,
  team,
  statusOptions,
  recruiterOptions,
  accountManagerOptions,
  canManageOptions,
  onAddOption,
  onEditOption,
  onDeleteOption,
}: {
  app: TrackerApplication | null;
  cand: TrackerCandidate | null;
  onClose: () => void;
  onSaved: () => void;
  team?: TrackerTeam;
  statusOptions: TrackerOption[];
  recruiterOptions: TrackerOption[];
  accountManagerOptions: TrackerOption[];
  canManageOptions: boolean;
  onAddOption: (kind: string, value: string) => Promise<void>;
  onEditOption: (kind: string, id: string, value: string) => Promise<void>;
  onDeleteOption: (kind: string, id: string) => Promise<void>;
}) {
  const { token } = useAuthStore();
  const [appliedDate, setAppliedDate] = useState('');
  const [position, setPosition] = useState('');
  const [client, setClient] = useState('');
  const [status, setStatus] = useState('MRF Pending');
  const [recruiter, setRecruiter] = useState('');
  const [accountManager, setAccountManager] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!app) return;
    setAppliedDate(app.applied_date ? String(app.applied_date) : '');
    setPosition(app.position || ''); setClient(app.client || '');
    setStatus(app.status || 'MRF Pending'); setRecruiter(app.recruiter || '');
    setAccountManager(app.account_manager || ''); setComment(app.comment || '');
  }, [app]);

  return (
    <Dialog open={!!app} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl animate-page-enter border-slate-200 bg-white text-slate-900 shadow-[var(--shadow-md)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-slate-900">Edit Application</DialogTitle>
          <DialogDescription>Update the candidate’s tracking fields.</DialogDescription>
          {cand && <p className="text-sm text-slate-500 mt-1">Candidate: <span className="font-semibold text-slate-800">{cand.name}</span></p>}
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <FieldRow label="Date"><DatePicker value={appliedDate} onChange={setAppliedDate} label="Application date" /></FieldRow>
          <FieldRow label="Position"><FormInput value={position} onChange={setPosition} placeholder="e.g. DevOps Engineer" /></FieldRow>
          <FieldRow label="Client"><FormInput value={client} onChange={setClient} placeholder="e.g. FinEdge" /></FieldRow>
          <FieldRow label="Status">
            <ManagedSelect
              label="Status"
              value={status}
              options={statusOptions.map((o) => ({ id: o.id, value: o.value }))}
              canManage={false}
              onChange={setStatus}
              onAdd={async () => { }}
              onEdit={async () => { }}
              onDelete={async () => { }}
            />
          </FieldRow>
          <FieldRow label="Recruiter">
            <ManagedSelect
              label="Recruiter"
              value={recruiter}
              options={recruiterOptions.map((o) => ({ id: o.id, value: o.value }))}
              canManage={false}
              onChange={setRecruiter}
              onAdd={async () => { }}
              onEdit={async () => { }}
              onDelete={async () => { }}
            />
          </FieldRow>
          <FieldRow label="Account Manager">
            <ManagedSelect
              label="Account Manager"
              value={accountManager}
              options={accountManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
              canManage={false}
              onChange={setAccountManager}
              onAdd={async () => { }}
              onEdit={async () => { }}
              onDelete={async () => { }}
            />
          </FieldRow>
          <div className="sm:col-span-2">
            <FieldRow label="Comment">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="Add notes or comments..."
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"
              />
            </FieldRow>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!token || !app || saving}
            onClick={async () => {
              if (!token || !app) return; setSaving(true);
              try {
                await trackerApi.updateApplication(token, app.id, {
                  applied_date: appliedDate || null, position: position || null, client: client || null,
                  status: status || null, recruiter: recruiter || null, account_manager: accountManager || null,
                  comment: comment || null,
                }, team);
                onSaved(); onClose();
              } finally { setSaving(false); }
            }}
            className="bg-brand-600 text-white hover:bg-brand-700"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2 text-white" /> : <Save className="w-4 h-4 mr-2 text-white" />}
            <span className="text-white">Save changes</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NewJobOpeningDialog({
  onCreated,
  team,
  jobStatusOptions,
  requirementOptions,
  recruiterOptions,
  accountManagerOptions,
  recruitmentManagerOptions,
  canManageOptions,
  onAddOption,
  onEditOption,
  onDeleteOption,
}: {
  onCreated: () => void;
  team?: TrackerTeam;
  jobStatusOptions: TrackerOption[];
  requirementOptions: TrackerOption[];
  recruiterOptions: TrackerOption[];
  accountManagerOptions: TrackerOption[];
  recruitmentManagerOptions: TrackerOption[];
  canManageOptions: boolean;
  onAddOption: (kind: string, value: string) => Promise<void>;
  onEditOption: (kind: string, id: string, value: string) => Promise<void>;
  onDeleteOption: (kind: string, id: string) => Promise<void>;
}) {
  const { token } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [reqDate, setReqDate] = useState('');
  const [submissionDate, setSubmissionDate] = useState('');
  const [role, setRole] = useState('');
  const [requirement, setRequirement] = useState('');
  const [client, setClient] = useState('');
  const [recruiter, setRecruiter] = useState('');
  const [recruitmentManager, setRecruitmentManager] = useState('');
  const [accountManager, setAccountManager] = useState('');
  const [cvsSubmittedCount, setCvsSubmittedCount] = useState<string>('');
  const [comments, setComments] = useState('');
  const [status, setStatus] = useState('Open');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setReqDate('');
    setSubmissionDate('');
    setRole('');
    setRequirement('');
    setClient('');
    setRecruiter('');
    setRecruitmentManager('');
    setAccountManager('');
    setCvsSubmittedCount('');
    setComments('');
    setStatus('Open');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="bg-brand-600 text-white gap-1.5 hover:bg-brand-700"
        >
          <Plus className="w-4 h-4 text-white" /> New Requirement
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg animate-page-enter border-slate-200 bg-white text-slate-900 shadow-[var(--shadow-md)]">
        <DialogHeader>
          <DialogTitle className="text-slate-900">Create Requirement</DialogTitle>
          <DialogDescription>Add a new requirement row.</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto max-h-[70vh] pr-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <FieldRow label="Requirement date"><DatePicker value={reqDate} onChange={setReqDate} label="Requirement date" /></FieldRow>
            <FieldRow label="Submission date"><DatePicker value={submissionDate} onChange={setSubmissionDate} label="Submission date" /></FieldRow>
            <div className="sm:col-span-2"><FieldRow label="Role"><FormInput value={role} onChange={setRole} placeholder="e.g. DevOps Engineer" /></FieldRow></div>
            <FieldRow label="Client"><FormInput value={client} onChange={setClient} placeholder="e.g. FinEdge" /></FieldRow>
            <div className="sm:col-span-2 flex gap-4">
              <div className="w-1/4">
                <FieldRow label="No. of CVs">
                  <FormInput
                    value={cvsSubmittedCount}
                    onChange={(v) => setCvsSubmittedCount(v.replace(/[^\d]/g, '').slice(0, 6))}
                    placeholder="e.g. 12"
                  />
                </FieldRow>
              </div>
              <div className="flex-1">
                <FieldRow label="Status">
                  <ManagedSelect
                    label="Status"
                    value={status}
                    options={jobStatusOptions.map((o) => ({ id: o.id, value: o.value }))}
                    canManage={false}
                    onChange={setStatus}
                    onAdd={async () => { }}
                    onEdit={async () => { }}
                    onDelete={async () => { }}
                  />
                </FieldRow>
              </div>
            </div>
            <FieldRow label="Recruiter">
              <ManagedSelect
                label="Recruiter"
                value={recruiter}
                options={recruiterOptions.map((o) => ({ id: o.id, value: o.value }))}
                canManage={false}
                onChange={setRecruiter}
                onAdd={async () => { }}
                onEdit={async () => { }}
                onDelete={async () => { }}
              />
            </FieldRow>
            <FieldRow label="Recruitment Manager">
              <ManagedSelect
                label="Recruitment Manager"
                value={recruitmentManager}
                options={recruitmentManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
                canManage={false}
                onChange={setRecruitmentManager}
                onAdd={async () => { }}
                onEdit={async () => { }}
                onDelete={async () => { }}
              />
            </FieldRow>
            <FieldRow label="Account Manager">
              <ManagedSelect
                label="Account Manager"
                value={accountManager}
                options={accountManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
                canManage={false}
                onChange={setAccountManager}
                onAdd={async () => { }}
                onEdit={async () => { }}
                onDelete={async () => { }}
              />
            </FieldRow>
            <div className="sm:col-span-2">
              <FieldRow label="Comments">
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={4}
                  placeholder="Comments..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none min-h-[120px]"
                />
              </FieldRow>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 bg-white">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!role.trim() || !token || saving} onClick={async () => {
            if (!token) return; setSaving(true);
            try {
              await trackerApi.createJobOpening(token, {
                title: role.trim(),
                requirement: requirement || null,
                client: client.trim() || undefined,
                status,
                hiring_manager: recruiter.trim() || undefined,
                recruitment_manager: recruitmentManager.trim() || undefined,
                department: accountManager.trim() || undefined,
                req_date: reqDate || null,
                submission_date: submissionDate || null,
                cvs_submitted_count: cvsSubmittedCount ? Number(cvsSubmittedCount) : null,
                comments: comments.trim() || null,
              } as any, team);
              setOpen(false); reset(); onCreated();
            } catch (e: any) {
              const msg =
                e?.response?.data?.detail ??
                e?.response?.data?.error ??
                e?.message ??
                'Could not create requirement';
              window.alert(typeof msg === 'string' ? msg : JSON.stringify(msg));
            } finally { setSaving(false); }
          }} className="bg-brand-600 text-white hover:bg-brand-700">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NewCandidateDialog({
  onCreated,
  team,
  statusOptions,
  recruiterOptions,
  accountManagerOptions,
  recruitmentManagerOptions,
  canManageOptions,
  onAddOption,
  onEditOption,
  onDeleteOption,
}: {
  onCreated: () => void;
  team?: TrackerTeam;
  statusOptions: TrackerOption[];
  recruiterOptions: TrackerOption[];
  accountManagerOptions: TrackerOption[];
  recruitmentManagerOptions: TrackerOption[];
  canManageOptions: boolean;
  onAddOption: (kind: string, value: string) => Promise<void>;
  onEditOption: (kind: string, id: string, value: string) => Promise<void>;
  onDeleteOption: (kind: string, id: string) => Promise<void>;
}) {
  const { token } = useAuthStore();
  const [open, setOpen] = useState(false);
  // candidate fields
  const [name, setName] = useState('');
  // application fields
  const [appliedDate, setAppliedDate] = useState('');
  const [position, setPosition] = useState('');
  const [client, setClient] = useState('');
  const [status, setStatus] = useState('MRF Pending');
  const [recruiter, setRecruiter] = useState('');
  const [accountManager, setAccountManager] = useState('');
  const [recruitmentManager, setRecruitmentManager] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(''); setAppliedDate(''); setPosition(''); setClient('');
    setStatus('MRF Pending'); setRecruiter(''); setAccountManager(''); setRecruitmentManager(''); setComment('');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-brand-600 text-white gap-1.5 hover:bg-brand-700">
          <Plus className="w-4 h-4 text-white" /> New Candidate
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl animate-page-enter border-slate-200 bg-white text-slate-900 shadow-[var(--shadow-md)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-slate-900">Add Candidate</DialogTitle>
          <DialogDescription>Create a candidate and tracking record.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <FieldRow label="Date"><DatePicker value={appliedDate} onChange={setAppliedDate} label="Date" /></FieldRow>
          <div className="sm:col-span-2"><FieldRow label="Candidate Name"><FormInput value={name} onChange={setName} placeholder="e.g. Ahmed Hassan" /></FieldRow></div>
          <FieldRow label="Position"><FormInput value={position} onChange={setPosition} placeholder="e.g. DevOps Engineer" /></FieldRow>
          <FieldRow label="Client"><FormInput value={client} onChange={setClient} placeholder="e.g. FinEdge" /></FieldRow>
          <FieldRow label="Status">
            <ManagedSelect
              label="Status"
              value={status}
              options={statusOptions.map((o) => ({ id: o.id, value: o.value }))}
              canManage={false}
              onChange={setStatus}
              onAdd={async () => { }}
              onEdit={async () => { }}
              onDelete={async () => { }}
            />
          </FieldRow>
          <FieldRow label="Recruiter">
            <ManagedSelect
              label="Recruiter"
              value={recruiter}
              options={recruiterOptions.map((o) => ({ id: o.id, value: o.value }))}
              canManage={false}
              onChange={setRecruiter}
              onAdd={async () => { }}
              onEdit={async () => { }}
              onDelete={async () => { }}
            />
          </FieldRow>
          <FieldRow label="Account Manager">
            <ManagedSelect
              label="Account Manager"
              value={accountManager}
              options={accountManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
              canManage={false}
              onChange={setAccountManager}
              onAdd={async () => { }}
              onEdit={async () => { }}
              onDelete={async () => { }}
            />
          </FieldRow>
          <FieldRow label="Recruitment Manager">
            <ManagedSelect
              label="Recruitment Manager"
              value={recruitmentManager}
              options={recruitmentManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
              canManage={false}
              onChange={setRecruitmentManager}
              onAdd={async () => { }}
              onEdit={async () => { }}
              onDelete={async () => { }}
            />
          </FieldRow>
          <div className="sm:col-span-2">
            <FieldRow label="Comment">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Add notes or comments..."
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"
              />
            </FieldRow>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!name.trim() || !token || saving} onClick={async () => {
            if (!token) return; setSaving(true);
            try {
              // Create candidate first, then create application record with all tracking fields
              const cand = await trackerApi.createCandidate(token, { name: name.trim() } as any, team);
              await trackerApi.createApplication(token, {
                candidate_id: cand.id,
                applied_date: appliedDate || undefined,
                position: position.trim() || undefined,
                client: client.trim() || undefined,
                status,
                recruiter: recruiter || undefined,
                account_manager: accountManager || undefined,
                recruitment_manager: recruitmentManager || undefined,
                comment: comment.trim() || undefined,
              }, team);
              setOpen(false); reset(); onCreated();
            } catch (e: any) {
              const msg =
                e?.response?.data?.detail ??
                e?.response?.data?.error ??
                e?.message ??
                'Could not create candidate';
              window.alert(typeof msg === 'string' ? msg : JSON.stringify(msg));
            } finally { setSaving(false); }
          }} className="bg-brand-600 hover:bg-brand-700 text-white">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FollowUpDialog({
  mode,
  initial,
  team,
  recruiterOptions,
  accountManagerOptions,
  recruitmentManagerOptions,
  followUpStageOptions,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: TrackerFollowUp;
  team?: TrackerTeam;
  recruiterOptions: TrackerOption[];
  accountManagerOptions: TrackerOption[];
  recruitmentManagerOptions: TrackerOption[];
  followUpStageOptions: TrackerOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuthStore();
  const [saving, setSaving] = useState(false);

  const [clientName, setClientName] = useState(initial?.client_name ?? '');
  const [position, setPosition] = useState(initial?.position ?? '');
  const [recruiterName, setRecruiterName] = useState(initial?.recruiter_name ?? '');
  const [accountManager, setAccountManager] = useState(initial?.account_manager ?? '');
  const [recruitmentManager, setRecruitmentManager] = useState(initial?.recruitment_manager ?? '');
  const [cvSubmittedDate, setCvSubmittedDate] = useState(initial?.cv_submitted_date ?? '');
  const [currentStage, setCurrentStage] = useState(initial?.current_stage ?? 'Feedback Pending');
  const [lastFollowUpDate, setLastFollowUpDate] = useState(initial?.last_follow_up_date ?? '');
  const [nextFollowUpDate, setNextFollowUpDate] = useState(initial?.next_follow_up_date ?? '');
  const [interviewDate, setInterviewDate] = useState(initial?.interview_date ?? '');
  const [clientFeedback, setClientFeedback] = useState(initial?.client_feedback ?? '');
  const [interviewFeedback, setInterviewFeedback] = useState(initial?.interview_feedback ?? '');
  const [remarks, setRemarks] = useState(initial?.remarks ?? '');
  const stageOptions = followUpStageOptions?.length
    ? followUpStageOptions
    : (FOLLOW_UP_STAGE_OPTIONS.map((s: string) => ({ id: `stage:${s}`, value: s })) as any);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl animate-page-enter border-slate-200 bg-white text-slate-900 shadow-[var(--shadow-md)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-slate-900">{mode === 'create' ? 'Add Follow-up' : 'Edit Follow-up'}</DialogTitle>
          <DialogDescription>Manage client and recruiter follow-up records.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <FieldRow label="Client Name">
            <FormInput value={clientName} onChange={setClientName} placeholder="e.g. FinEdge" />
          </FieldRow>
          <FieldRow label="Position">
            <FormInput value={position} onChange={setPosition} placeholder="e.g. Network Engineer" />
          </FieldRow>
          <FieldRow label="Recruiter Name">
            <ManagedSelect
              label="Recruiter"
              value={recruiterName}
              options={recruiterOptions.map((o) => ({ id: o.id, value: o.value }))}
              canManage={false}
              onChange={setRecruiterName}
              onAdd={async () => { }}
              onEdit={async () => { }}
              onDelete={async () => { }}
            />
          </FieldRow>
          <FieldRow label="Recruitment Manager">
            <ManagedSelect
              label="Recruitment Manager"
              value={recruitmentManager}
              options={recruitmentManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
              canManage={false}
              onChange={setRecruitmentManager}
              onAdd={async () => { }}
              onEdit={async () => { }}
              onDelete={async () => { }}
            />
          </FieldRow>
          <FieldRow label="Account Manager">
            <ManagedSelect
              label="Account Manager"
              value={accountManager}
              options={accountManagerOptions.map((o) => ({ id: o.id, value: o.value }))}
              canManage={false}
              onChange={setAccountManager}
              onAdd={async () => { }}
              onEdit={async () => { }}
              onDelete={async () => { }}
            />
          </FieldRow>
          <FieldRow label="Current Stage">
            <ManagedSelect
              label="Current Stage"
              value={currentStage}
              options={stageOptions.map((o: any) => ({ id: o.id, value: o.value }))}
              canManage={false}
              onChange={setCurrentStage}
              onAdd={async () => { }}
              onEdit={async () => { }}
              onDelete={async () => { }}
            />
          </FieldRow>
          <FieldRow label="CV Submitted Date">
            <DatePicker value={cvSubmittedDate || ''} onChange={setCvSubmittedDate} label="CV Submitted Date" />
          </FieldRow>
          <FieldRow label="Follow Up Date">
            <DatePicker value={lastFollowUpDate || ''} onChange={setLastFollowUpDate} label="Follow Up Date" />
          </FieldRow>
          <FieldRow label="Next Follow-up Date">
            <DatePicker
              value={nextFollowUpDate || ''}
              onChange={setNextFollowUpDate}
              label="Next Follow-up Date"
              max={(() => {
                const d = new Date();
                d.setDate(d.getDate() + 5);
                return d.toISOString().split('T')[0];
              })()}
            />
          </FieldRow>
          <FieldRow label="Interview Date">
            <DatePicker value={interviewDate || ''} onChange={setInterviewDate} label="Interview Date" />
          </FieldRow>
          <div className="sm:col-span-2">
            <FieldRow label="Client Feedback">
              <textarea
                value={clientFeedback}
                onChange={(e) => setClientFeedback(e.target.value)}
                rows={2}
                placeholder="Client feedback..."
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"
              />
            </FieldRow>
          </div>
          <div className="sm:col-span-2">
            <FieldRow label="Interview Feedback">
              <textarea
                value={interviewFeedback}
                onChange={(e) => setInterviewFeedback(e.target.value)}
                rows={2}
                placeholder="Interview feedback..."
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"
              />
            </FieldRow>
          </div>
          <div className="sm:col-span-2">
            <FieldRow label="Remarks">
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                placeholder="Remarks..."
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"
              />
            </FieldRow>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!token || !clientName.trim() || saving}
            onClick={async () => {
              if (!token) return;
              setSaving(true);
              try {
                const payload = {
                  client_name: clientName.trim(),
                  position: position.trim() || null,
                  recruiter_name: recruiterName.trim() || null,
                  account_manager: accountManager.trim() || null,
                  recruitment_manager: recruitmentManager.trim() || null,
                  cv_submitted_date: cvSubmittedDate || null,
                  current_stage: currentStage,
                  last_follow_up_date: lastFollowUpDate || null,
                  next_follow_up_date: nextFollowUpDate || null,
                  interview_date: interviewDate || null,
                  client_feedback: clientFeedback.trim() || null,
                  interview_feedback: interviewFeedback.trim() || null,
                  remarks: remarks.trim() || null,
                } as any;

                if (mode === 'create') {
                  await trackerApi.createFollowUp(token, payload, team);
                } else {
                  await trackerApi.updateFollowUp(token, initial!.id, payload, team);
                }
                onSaved();
                onClose();
              } catch (e: any) {
                const msg =
                  e?.response?.data?.detail ??
                  e?.response?.data?.error ??
                  e?.message ??
                  'Could not save follow-up';
                window.alert(typeof msg === 'string' ? msg : JSON.stringify(msg));
              } finally {
                setSaving(false);
              }
            }}
            className="bg-brand-600 text-white hover:bg-brand-700"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2 text-white" /> : <Save className="w-4 h-4 mr-2 text-white" />}
            <span className="text-white">Save</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
