import React, { useState, useEffect } from 'react';
import { Upload, FileText, AlertCircle, Check, ExternalLink, Copy, Edit3, Briefcase, Save, CheckCircle, Loader2, ImageIcon } from '@/components/icons';
import { useCareersStore } from '@/stores/careersStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useToast, ToastContainer } from '@/components/ui/toast';
import HiringImageDialog from './HiringImageDialog';
import JobPostedCelebration, { type JobPostedCelebrationPayload } from './JobPostedCelebration';

interface JobPostingFormProps {
  onSuccess: () => void;
  jobId?: string; // For editing existing jobs
  publicToken?: string; // For preserving the public token when editing
  /** Start from a job description already in the library (e.g. from a requirement): its details are filled in and nothing is posted until the person clicks Post job. */
  fromJdId?: string;
  fromJdName?: string;
  /** Called with the new job's id once it is posted. */
  onPosted?: (jobId: string) => void;
  initialData?: {
    jobTitle: string;
    jobLocation: string;
    jobSummary: string;
    keyResponsibilities: string;
    qualifications: string;
  };
}

const cardClass =
  'rounded-xl border border-surface-border bg-paper shadow-card';
const inputClass =
  'w-full rounded-md border border-surface-border bg-paper px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30';

export default function JobPostingForm({ onSuccess, jobId, publicToken, initialData, fromJdId, fromJdName, onPosted }: JobPostingFormProps) {
  const { createJobPostingWithFormData, isCreatingJob, error, clearError } = useCareersStore();
  const { toasts, showSuccess, showError, removeToast } = useToast();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [success, setSuccess] = useState<{link: string, token: string, jobId: string, emailSubjectTemplate?: string, booleanSearchString?: string} | null>(null);
  const [celebration, setCelebration] = useState<JobPostedCelebrationPayload | null>(null);
  const [booleanCopied, setBooleanCopied] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [copied, setCopied] = useState(false);
  const [emailSubjectCopied, setEmailSubjectCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form data state
  const [formData, setFormData] = useState({
    jobTitle: initialData?.jobTitle || '',
    jobLocation: initialData?.jobLocation || '',
    jobSummary: initialData?.jobSummary || '',
    keyResponsibilities: initialData?.keyResponsibilities || '',
    qualifications: initialData?.qualifications || ''
  });

  // Two-phase upload states
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploaded' | 'autofilled'>('idle');
  const [jdId, setJdId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [showForm, setShowForm] = useState(false); // Only show after auto-fill

  // Auto-scroll to form when component mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      const formElement = document.getElementById('job-posting-form');
      if (formElement) {
        formElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest'
        });
      }
    }, 100); // Small delay to ensure DOM is ready

    return () => clearTimeout(timer);
  }, []);

  // Started from a stored job description: read its details into the form (the job is posted only by the Post job button)
  useEffect(() => {
    if (!fromJdId || jobId) return;
    let cancelled = false;
    setJdId(fromJdId);
    setUploadPhase('uploaded');
    setIsAutoFilling(true);
    (async () => {
      try {
        const ui = await api.extractJDForUI(fromJdId);
        if (cancelled) return;
        if (ui.success) {
          setFormData({
            jobTitle: ui.job_title || '', jobLocation: ui.job_location || '', jobSummary: ui.job_summary || '',
            keyResponsibilities: ui.key_responsibilities || '', qualifications: ui.qualifications || '',
          });
          setUploadPhase('autofilled');
        } else {
          showError('Auto-fill Failed', 'Please fill the form manually.');
        }
      } catch {
        if (!cancelled) showError('Auto-fill Failed', 'Please fill the form manually.');
      } finally {
        if (!cancelled) { setShowForm(true); setIsAutoFilling(false); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromJdId]);

  // Initialize success state for editing mode
  useEffect(() => {
    if (jobId && initialData) {
      // In edit mode, always show the form
      setShowForm(true);

      if (publicToken) {
        // Job has a valid token, preserve it
        setSuccess({
          link: `${window.location.origin}/careers/jobs/${publicToken}`,
          token: publicToken,
          jobId: jobId
        });
      } else {
        // Job doesn't have a valid token, show a message
        setSuccess({
          link: 'Token will be generated after update',
          token: 'Will be generated',
          jobId: jobId
        });
      }
    }
  }, [jobId, initialData, publicToken]);

  const handleFileSelect = async (file: File) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain'
    ];

    if (!allowedTypes.includes(file.type)) {
      clearError();
      showError('File type not accepted', 'Choose a PDF, Word (.doc, .docx) or text (.txt) file.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      showError('File is too large', `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The most you can upload is 5 MB.`);
      return;
    }

    setSelectedFile(file);
    clearError();

    // Automatically start the extraction process
    await handleUploadJD(file);
  };

  // Upload JD, then extract details into the form in one go (no separate Extract step).
  const handleUploadJD = async (file?: File) => {
    const fileToProcess = file || selectedFile;
    if (!fileToProcess) return;

    setIsUploading(true);
    try {
      const response = await api.uploadJD(fileToProcess);

      if (response.status === 'success' && response.jd_id) {
        setJdId(response.jd_id);
        setIsUploading(false);
        await handleAutoFillForm(response.jd_id);
      } else {
        showError('Upload Failed', 'Please try again or contact support.');
      }
    } catch (error) {
      console.error('Failed to process JD:', error);
      showError('Upload Failed', 'Please try again or contact support.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAutoFillForm = async (id?: string) => {
    const targetId = id || jdId;
    if (!targetId) return;

    setIsAutoFilling(true);
    try {
      const uiData = await api.extractJDForUI(targetId);

      if (uiData.success) {
        setFormData({
          jobTitle: uiData.job_title || '',
          jobLocation: uiData.job_location || '',
          jobSummary: uiData.job_summary || '',
          keyResponsibilities: uiData.key_responsibilities || '',
          qualifications: uiData.qualifications || ''
        });
        setJdId(uiData.jd_id || targetId);
        setUploadPhase('autofilled');
        setShowForm(true);
      } else {
        showError('Auto-fill Failed', 'Please try again or fill the form manually.');
        setShowForm(true);
      }
    } catch (error) {
      console.error('Failed to auto-fill form:', error);
      showError('Auto-fill Failed', 'Please try again or fill the form manually.');
      setShowForm(true);
    } finally {
      setIsAutoFilling(false);
    }
  };

  // Handle form input changes
  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await handleFileSelect(files[0]);
    }
  };

  const handleSave = async () => {
    const currentJobId = jobId || success?.jobId;
    if (!currentJobId) {
      console.error('No job ID available for saving');
      return;
    }

    setIsSaving(true);
    setSaveSuccess(false);

    try {
      // Use unified endpoint for updating existing job
      const result = await api.unifiedJobUpdate(null, currentJobId, formData);

      if (result.success) {
        setSaveSuccess(true);
        showSuccess('Changes Saved Successfully!', 'Your job posting has been updated.');
        // Call onSuccess immediately to refresh data and close dialog
        onSuccess();
      }
    } catch (error) {
      console.error('Failed to save job posting updates:', error);
      showError('Failed to Save Changes', 'Please try again or contact support if the issue persists.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {

    if (!selectedFile && Object.values(formData).every(v => !v.trim())) {
      return; // No file and no form data
    }

    // Check if already processing
    if (isCreatingJob || isUploading || isAutoFilling) {
      return;
    }


    try {
      let result;


      if (uploadPhase === 'autofilled' && jdId) {
        // If we have auto-filled data from the two-phase system, use the unified endpoint
        // This will create a job posting with the edited/auto-filled human-readable content
        result = await api.unifiedJobUpdate(jdId, null, formData);
      } else if (jdId && Object.values(formData).some(v => v.trim())) {
        // If we have a JD ID and form data (even if not in autofilled phase), use the unified system
        result = await api.unifiedJobUpdate(jdId, null, formData);
      } else if (selectedFile) {
        // If there's a file but no auto-fill yet, use the old method
        result = await createJobPostingWithFormData(selectedFile, formData);
      } else {
        // If no file but has form data, use manual job posting
        result = await createJobPostingWithFormData(null, formData);
      }

    if (result) {
      setSuccess({
        link: result.public_link || `${window.location.origin}/careers/jobs/${result.public_token}`,
          token: result.public_token,
          jobId: result.job_id,
          emailSubjectTemplate: result.email_subject_template,
          booleanSearchString: result.boolean_search_string
      });
      setSelectedFile(null);
      if (result.job_id) onPosted?.(result.job_id);
        // Keep form data for editing
        setShowForm(true);
        setCelebration({
          title: formData.jobTitle.trim() || 'Your job',
          location: formData.jobLocation.trim() || null,
        });
      }
    } catch (error) {
      console.error('Failed to create job posting:', error);
      showError('Failed to Post Job', 'Please try again or contact support if the issue persists.');
    }
  };

  const handleViewJob = () => {
    if (success?.link) {
      window.open(success.link, '_blank');
    }
  };

  // Robust copy implementation
  const copyToClipboard = async (text: string) => {
    try {
      // Modern browsers
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Fallback for older browsers
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textArea);
        return success;
      } catch (fallbackErr) {
        return false;
      }
    }
  };

  const handleCopyLink = async () => {
    if (success?.link) {
      const copySuccess = await copyToClipboard(success.link);
      if (copySuccess) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        console.error('Failed to copy link');
      }
    }
  };

  const handleCopyEmailSubject = async () => {
    if (success?.emailSubjectTemplate) {
      const copySuccess = await copyToClipboard(success.emailSubjectTemplate);
      if (copySuccess) {
        setEmailSubjectCopied(true);
        setTimeout(() => setEmailSubjectCopied(false), 2000);
        showSuccess('Subject Copied!', 'The unique subject line for this job is on your clipboard.');
      } else {
        console.error('Failed to copy email subject');
        showError('Copy Failed', 'Please try again or copy the text manually.');
      }
    }
  };

  const handleCopyBoolean = async () => {
    if (success?.booleanSearchString) {
      const copied = await copyToClipboard(success.booleanSearchString);
      if (copied) {
        setBooleanCopied(true);
        setTimeout(() => setBooleanCopied(false), 2000);
        showSuccess('Boolean String Copied!', 'Paste this into Naukri Gulf Resdex search.');
      } else {
        showError('Copy Failed', 'Please try again or copy the text manually.');
      }
    }
  };

  // Handle file input click directly
  const handleFileInputClick = () => {
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  };

  return (
    <>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <JobPostedCelebration
        data={celebration}
        onClose={() => { setCelebration(null); onSuccess(); }}
        onViewJob={success?.link ? () => { setCelebration(null); handleViewJob(); onSuccess(); } : undefined}
      />
      {showImage && success && <HiringImageDialog jobId={success.jobId} title={formData.jobTitle} onClose={() => setShowImage(false)} />}
      <div id="job-posting-form" className={`${cardClass} scroll-mt-20 overflow-hidden`}>
        {/* Card header */}
        <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-600">
              {jobId ? <Edit3 className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {jobId || success ? 'Edit job posting' : 'New job posting'}
              </h2>
              <p className="text-xs text-slate-500">
                {jobId
                  ? 'Update the job details below.'
                  : 'Upload a JD to auto-fill, or enter details manually.'}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Success (after posting) */}
          {success && !jobId && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3">
              <div className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                <div className="min-w-0 flex-1 space-y-2 text-sm text-green-800">
                  <p className="font-semibold">Job posting created successfully.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Public link:</span>
                    <code className="max-w-xs truncate rounded bg-paper px-2 py-1 font-mono text-xs text-slate-700">
                      {success.link}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      title="Copy job posting link"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-green-700 hover:bg-green-100"
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={handleViewJob}
                      title="Preview job posting"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-green-700 hover:bg-green-100"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setShowImage(true)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-green-300 bg-paper px-2.5 py-1.5 text-xs font-semibold text-green-800 transition-colors hover:bg-green-100"
                    >
                      <ImageIcon className="h-3.5 w-3.5" /> Create hiring image
                    </button>
                  </div>

                  {success?.emailSubjectTemplate && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-amber-800">
                      <p className="text-xs font-semibold">Job subject line</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-paper px-2 py-1 font-mono text-xs text-amber-900">
                          {success.emailSubjectTemplate}
                        </code>
                        <button
                          type="button"
                          onClick={handleCopyEmailSubject}
                          title="Copy the subject line"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-amber-700 hover:bg-amber-100"
                        >
                          {emailSubjectCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="mt-1.5 text-xs">
                        A unique reference generated for this job.
                      </p>
                    </div>
                  )}

                  {success?.booleanSearchString && (
                    <div className="rounded-md border border-navy-200 bg-navy-50 p-2.5 text-navy-800">
                      <p className="text-xs font-semibold">Naukri Gulf boolean search string</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-paper px-2 py-1 font-mono text-xs text-navy-900" title={success.booleanSearchString}>
                          {success.booleanSearchString}
                        </code>
                        <button
                          type="button"
                          onClick={handleCopyBoolean}
                          title="Copy boolean search string"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-navy-700 hover:bg-navy-100"
                        >
                          {booleanCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="mt-1.5 text-xs">
                        Paste this into Naukri Gulf Resdex to find matching candidates.
                      </p>
                    </div>
                  )}

                  <p className="text-xs">
                    You can edit the job details below and click Save changes to update the posting.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Save success */}
          {saveSuccess && (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div>
                <p className="font-semibold">Job posting updated successfully.</p>
                <p className="text-xs">Your changes have been saved.</p>
              </div>
            </div>
          )}

          {/* The job description in use, when started from one */}
          {fromJdId && !jobId && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              <FileText className="h-4 w-4 shrink-0 text-navy-700" />
              <span className="min-w-0 truncate">Job description: <span className="font-semibold text-slate-900">{fromJdName || 'from the requirement'}</span></span>
              {isAutoFilling && <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading it...</span>}
            </div>
          )}

          {/* Upload group */}
          {!fromJdId && (
          <div className="space-y-2">
            <p className="section-label">Job description file</p>
            <div
              className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                jobId
                  ? 'cursor-not-allowed border-surface-border bg-slate-50 opacity-60'
                  : dragActive
                  ? 'border-brand-400 bg-brand-50'
                  : selectedFile
                  ? 'border-green-300 bg-green-50/60'
                  : 'border-slate-300 bg-slate-50 hover:border-brand-300 hover:bg-brand-50/40'
              }`}
              onDragEnter={jobId ? undefined : (e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={jobId ? undefined : (e) => { e.preventDefault(); setDragActive(false); }}
              onDragOver={jobId ? undefined : (e) => e.preventDefault()}
              onDrop={jobId ? undefined : handleDrop}
            >
              {jobId ? (
                <div className="space-y-1.5">
                  <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                    <Edit3 className="h-5 w-5 text-slate-400" />
                  </span>
                  <p className="text-sm font-medium text-slate-700">Edit mode</p>
                  <p className="text-xs text-slate-500">File upload is disabled. Edit the fields below.</p>
                </div>
              ) : selectedFile ? (
                <div className="space-y-2">
                  <span className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${isUploading || isAutoFilling ? 'bg-brand-50' : 'bg-green-100'}`}>
                    {isUploading || isAutoFilling ? (
                      <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
                    ) : uploadPhase === 'autofilled' ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <FileText className="h-5 w-5 text-green-600" />
                    )}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{selectedFile.name}</p>
                    <p className="text-xs text-slate-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    {isUploading && <p className="mt-0.5 text-xs font-medium text-brand-600">Processing…</p>}
                    {!isUploading && isAutoFilling && <p className="mt-0.5 text-xs font-medium text-brand-600">Extracting details…</p>}
                    {uploadPhase === 'autofilled' && !isAutoFilling && <p className="mt-0.5 text-xs font-medium text-green-600">Details extracted</p>}
                  </div>
                  {!isUploading && !isAutoFilling && uploadPhase === 'idle' && (
                    <div className="flex justify-center gap-2">
                      <Button variant="primary" size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => handleUploadJD()}>
                        Upload JD
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedFile(null);
                          setShowForm(false);
                          setUploadPhase('idle');
                          setFormData({ jobTitle: '', jobLocation: '', jobSummary: '', keyResponsibilities: '', qualifications: '' });
                        }}
                      >
                        Remove file
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-brand-50">
                    <Upload className="h-5 w-5 text-brand-600" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-900">Upload job description</p>
                    <p className="mt-0.5 text-xs text-slate-500">Drag &amp; drop or select a file, it is processed automatically.</p>
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-2xs text-slate-400">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">PDF</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">DOC</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">DOCX</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">TXT</span>
                    <span>· Max 5MB</span>
                  </div>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.txt"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) await handleFileSelect(file);
                    }}
                    className="hidden"
                    id="file-upload"
                  />
                  <Button variant="secondary" size="sm" icon={<Upload className="h-4 w-4" />} onClick={handleFileInputClick}>
                    Select file
                  </Button>
                </div>
              )}
            </div>
          </div>

          )}

          {/* Job details form */}
          {(showForm || success || jobId) && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="section-label">Job details</p>
                {uploadPhase === 'autofilled' && <Badge>Auto-filled from JD</Badge>}
                {(success || jobId) && <Badge variant="success">Editable</Badge>}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-700">Job title *</label>
                  <input
                    type="text"
                    value={formData.jobTitle}
                    onChange={(e) => handleInputChange('jobTitle', e.target.value)}
                    placeholder="e.g. Senior Software Engineer"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-700">Location</label>
                  <input
                    type="text"
                    value={formData.jobLocation}
                    onChange={(e) => handleInputChange('jobLocation', e.target.value)}
                    placeholder="e.g. Remote, Dubai, UAE"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">Job summary</label>
                <textarea
                  value={formData.jobSummary}
                  onChange={(e) => handleInputChange('jobSummary', e.target.value)}
                  placeholder="Brief overview of the role and company…"
                  rows={4}
                  className={`${inputClass} resize-y`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">Key responsibilities</label>
                <textarea
                  value={formData.keyResponsibilities}
                  onChange={(e) => handleInputChange('keyResponsibilities', e.target.value)}
                  placeholder="• Develop and maintain software applications&#10;• Collaborate with cross-functional teams…"
                  rows={5}
                  className={`${inputClass} resize-y`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">Qualifications &amp; requirements</label>
                <textarea
                  value={formData.qualifications}
                  onChange={(e) => handleInputChange('qualifications', e.target.value)}
                  placeholder="• Bachelor's degree in Computer Science&#10;• 3+ years of experience…"
                  rows={5}
                  className={`${inputClass} resize-y`}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap justify-end gap-2 border-t border-surface-border px-4 py-3 sm:px-5">
          <Button variant="secondary" onClick={onSuccess}>
            Cancel
          </Button>

          {(success || jobId) && (
            <Button
              variant="primary"
              icon={<Save className="h-4 w-4" />}
              onClick={handleSave}
              loading={isSaving}
            >
              {isSaving ? 'Saving…' : 'Save changes'}
            </Button>
          )}

          {!success && !jobId && (
            <Button
              variant="primary"
              icon={<Briefcase className="h-4 w-4" />}
              onClick={handleSubmit}
              loading={isCreatingJob || isUploading || isAutoFilling}
              disabled={
                (!selectedFile && !showForm) ||
                (showForm && !formData.jobTitle.trim()) ||
                isCreatingJob ||
                isUploading ||
                isAutoFilling
              }
            >
              {isCreatingJob ? 'Creating…' :
               isUploading ? 'Uploading…' :
               isAutoFilling ? 'Extracting…' :
               'Post job'}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
