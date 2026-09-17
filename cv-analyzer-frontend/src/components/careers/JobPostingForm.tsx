import React, { useState, useEffect } from 'react';
import { Upload, FileText, AlertCircle, Check, ExternalLink, Copy, Wand2, Edit3, Briefcase, Save, CheckCircle, Loader2 } from 'lucide-react';
import { useCareersStore } from '@/stores/careersStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useToast, ToastContainer } from '@/components/ui/toast';

interface JobPostingFormProps {
  onSuccess: () => void;
  jobId?: string; // For editing existing jobs
  publicToken?: string; // For preserving the public token when editing
  initialData?: {
    jobTitle: string;
    jobLocation: string;
    jobSummary: string;
    keyResponsibilities: string;
    qualifications: string;
  };
}

const cardClass =
  'rounded-lg border border-gray-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]';
const inputClass =
  'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30';

export default function JobPostingForm({ onSuccess, jobId, publicToken, initialData }: JobPostingFormProps) {
  const { createJobPosting, createJobPostingWithFormData, isCreatingJob, error, clearError } = useCareersStore();
  const { toasts, showSuccess, showError, removeToast } = useToast();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [success, setSuccess] = useState<{link: string, token: string, jobId: string, emailSubjectTemplate?: string, booleanSearchString?: string} | null>(null);
  const [booleanCopied, setBooleanCopied] = useState(false);
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
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      return;
    }

    setSelectedFile(file);
    clearError();

    // Automatically start the extraction process
    await handleUploadJD(file);
  };

  // Phase 1: Upload JD for matching (existing pipeline)
  const handleUploadJD = async (file?: File) => {
    const fileToProcess = file || selectedFile;
    if (!fileToProcess) return;

    setIsUploading(true);
    try {
      // Use existing upload endpoint that processes for matching
      const response = await api.uploadJD(fileToProcess);

      if (response.status === 'success' && response.jd_id) {
        setJdId(response.jd_id);
        setUploadPhase('uploaded');

        // Show success popup
        showSuccess(
          'JD Successfully Processed!',
          'Your job description has been sent to LLM and saved to database for candidate matching.'
        );

        // Automatically proceed to auto-fill phase
        setTimeout(() => {
          handleAutoFillForm();
        }, 1000); // Small delay to show the success message

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

  // Phase 2: Auto-fill form for UI display (new pipeline)
  const handleAutoFillForm = async () => {
    if (!jdId) return;

    setIsAutoFilling(true);
    try {
      // Call new endpoint for UI-focused extraction
      const uiData = await api.extractJDForUI(jdId);

      if (uiData.success) {
        // Fill form with human-readable data
        setFormData({
          jobTitle: uiData.job_title || '',
          jobLocation: uiData.job_location || '',
          jobSummary: uiData.job_summary || '',
          keyResponsibilities: uiData.key_responsibilities || '',
          qualifications: uiData.qualifications || ''
        });

        // Keep the JD ID for the final job posting step
        setJdId(uiData.jd_id || jdId);
        setUploadPhase('autofilled');
        setShowForm(true);
      } else {
        showError('Auto-fill Failed', 'Please try again or fill the form manually.');
        // Show form anyway for manual input
        setShowForm(true);
      }
    } catch (error) {
      console.error('Failed to auto-fill form:', error);
      showError('Auto-fill Failed', 'Please try again or fill the form manually.');
      // Show form anyway for manual input
      setShowForm(true);
    } finally {
      setIsAutoFilling(false);
    }
  };

  // Auto-fill form fields from processed data
  const handleAutoFill = (processedData: any) => {
    const jobRequirements = processedData.job_requirements || {};
    const structuredInfo = processedData.structured_info || {};

    setFormData({
      jobTitle: jobRequirements.job_title || structuredInfo.job_title || '',
      jobLocation: structuredInfo.location || structuredInfo.job_location || '',
      jobSummary: structuredInfo.job_summary || structuredInfo.summary || '',
      keyResponsibilities: Array.isArray(jobRequirements.responsibilities)
        ? jobRequirements.responsibilities.join('\n• ')
        : (structuredInfo.responsibilities || []).join('\n• '),
      qualifications: Array.isArray(jobRequirements.skills)
        ? jobRequirements.skills.join('\n• ')
        : (structuredInfo.skills || []).join('\n• ')
    });
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
        link: result.public_link,
          token: result.public_token,
          jobId: result.job_id,
          emailSubjectTemplate: result.email_subject_template,
          booleanSearchString: result.boolean_search_string
      });
      setSelectedFile(null);
        // Keep form data for editing
        setShowForm(true);

        showSuccess('Job Posted Successfully!', 'Your job posting is now live and ready to receive applications.');

      // Close form after delay
      setTimeout(() => {
        onSuccess();
      }, 5000);
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
        showSuccess('Email Subject Copied!', 'Paste this subject in your Naukri job posting to enable email CV processing.');
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
      <div id="job-posting-form" className={`${cardClass} scroll-mt-20 overflow-hidden`}>
        {/* Card header */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-600">
              {jobId ? <Edit3 className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {jobId || success ? 'Edit job posting' : 'New job posting'}
              </h2>
              <p className="text-[12px] text-gray-500">
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
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Success (after posting) */}
          {success && !jobId && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3">
              <div className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                <div className="min-w-0 flex-1 space-y-2 text-[13px] text-green-800">
                  <p className="font-semibold">Job posting created successfully.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Public link:</span>
                    <code className="max-w-xs truncate rounded bg-white px-2 py-1 font-mono text-[12px] text-gray-700">
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

                  {success?.emailSubjectTemplate && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-amber-800">
                      <p className="text-[12px] font-semibold">Naukri email subject</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[12px] text-amber-900">
                          {success.emailSubjectTemplate}
                        </code>
                        <button
                          type="button"
                          onClick={handleCopyEmailSubject}
                          title="Copy email subject for Naukri"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-amber-700 hover:bg-amber-100"
                        >
                          {emailSubjectCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[12px]">
                        Paste this exact subject in your Naukri posting so replied CVs are auto-processed.
                      </p>
                    </div>
                  )}

                  {success?.booleanSearchString && (
                    <div className="rounded-md border border-indigo-200 bg-indigo-50 p-2.5 text-indigo-800">
                      <p className="text-[12px] font-semibold">Naukri Gulf boolean search string</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[12px] text-indigo-900" title={success.booleanSearchString}>
                          {success.booleanSearchString}
                        </code>
                        <button
                          type="button"
                          onClick={handleCopyBoolean}
                          title="Copy boolean search string"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-indigo-700 hover:bg-indigo-100"
                        >
                          {booleanCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[12px]">
                        Paste this into Naukri Gulf Resdex to find matching candidates.
                      </p>
                    </div>
                  )}

                  <p className="text-[12px]">
                    You can edit the job details below and click Save changes to update the posting.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Save success */}
          {saveSuccess && (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-[13px] text-blue-800">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div>
                <p className="font-semibold">Job posting updated successfully.</p>
                <p className="text-[12px]">Your changes have been saved.</p>
              </div>
            </div>
          )}

          {/* Upload group */}
          <div className="space-y-2">
            <p className="section-label">Job description file</p>
            <div
              className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                jobId
                  ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
                  : dragActive
                  ? 'border-brand-400 bg-brand-50'
                  : selectedFile
                  ? 'border-green-300 bg-green-50/60'
                  : 'border-gray-300 bg-gray-50 hover:border-brand-300 hover:bg-brand-50/40'
              }`}
              onDragEnter={jobId ? undefined : (e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={jobId ? undefined : (e) => { e.preventDefault(); setDragActive(false); }}
              onDragOver={jobId ? undefined : (e) => e.preventDefault()}
              onDrop={jobId ? undefined : handleDrop}
            >
              {jobId ? (
                <div className="space-y-1.5">
                  <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                    <Edit3 className="h-5 w-5 text-gray-400" />
                  </span>
                  <p className="text-[13px] font-medium text-gray-700">Edit mode</p>
                  <p className="text-[12px] text-gray-500">File upload is disabled. Edit the fields below.</p>
                </div>
              ) : selectedFile ? (
                <div className="space-y-2">
                  <span className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${isUploading ? 'bg-brand-50' : 'bg-green-100'}`}>
                    {isUploading ? (
                      <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
                    ) : uploadPhase === 'uploaded' ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <FileText className="h-5 w-5 text-green-600" />
                    )}
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-gray-900">{selectedFile.name}</p>
                    <p className="text-[12px] text-gray-500">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    {isUploading && <p className="mt-0.5 text-[12px] font-medium text-brand-600">Processing…</p>}
                    {uploadPhase === 'uploaded' && <p className="mt-0.5 text-[12px] font-medium text-green-600">Processed successfully</p>}
                  </div>
                  {!isUploading && uploadPhase !== 'uploaded' && (
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
                    <p className="text-[13px] font-medium text-gray-900">Upload job description</p>
                    <p className="mt-0.5 text-[12px] text-gray-500">Drag &amp; drop or select a file — it is processed automatically.</p>
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5">PDF</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5">DOC</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5">DOCX</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5">TXT</span>
                    <span>· Max 10MB</span>
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

          {/* Phase 2: Extract details */}
          {uploadPhase === 'uploaded' && (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-green-200 bg-green-50/60 p-4 text-center">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <p className="text-[13px] font-medium text-gray-900">JD processed — extract details to review and edit</p>
              <Button
                variant="primary"
                icon={<Wand2 className="h-4 w-4" />}
                onClick={handleAutoFillForm}
                loading={isAutoFilling}
              >
                {isAutoFilling ? 'Extracting…' : 'Extract details'}
              </Button>
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
                  <label className="block text-[13px] font-medium text-gray-700">Job title *</label>
                  <input
                    type="text"
                    value={formData.jobTitle}
                    onChange={(e) => handleInputChange('jobTitle', e.target.value)}
                    placeholder="e.g. Senior Software Engineer"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-medium text-gray-700">Location</label>
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
                <label className="block text-[13px] font-medium text-gray-700">Job summary</label>
                <textarea
                  value={formData.jobSummary}
                  onChange={(e) => handleInputChange('jobSummary', e.target.value)}
                  placeholder="Brief overview of the role and company…"
                  rows={4}
                  className={`${inputClass} resize-y`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[13px] font-medium text-gray-700">Key responsibilities</label>
                <textarea
                  value={formData.keyResponsibilities}
                  onChange={(e) => handleInputChange('keyResponsibilities', e.target.value)}
                  placeholder="• Develop and maintain software applications&#10;• Collaborate with cross-functional teams…"
                  rows={5}
                  className={`${inputClass} resize-y`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[13px] font-medium text-gray-700">Qualifications &amp; requirements</label>
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
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-4 py-3 sm:px-5">
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
                (uploadPhase === 'uploaded' && !showForm) ||
                isCreatingJob ||
                isUploading ||
                isAutoFilling
              }
            >
              {isCreatingJob ? 'Creating…' :
               isUploading ? 'Uploading…' :
               isAutoFilling ? 'Auto-filling…' :
               (uploadPhase === 'uploaded' && !showForm) ? 'Extract details first' :
               'Post job'}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
