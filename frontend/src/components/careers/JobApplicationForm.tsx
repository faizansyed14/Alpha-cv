'use client';
import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Upload,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  X,
} from '@/components/icons';
import { api } from '@/lib/api';
import { countryFromNationality } from '@/lib/nationality';
import { useCareersStore } from '@/stores/careersStore';
import { Button } from '@/components/ui/button';
import LocationAutocomplete from '@/components/common/LocationAutocomplete';
import NationalityAutocomplete from '@/components/common/NationalityAutocomplete';

// Fixed notice-period choices on the apply form (the backend stores whatever string it is given).
export const NOTICE_PERIOD_OPTIONS = ['Immediately', '15 days', '30 days', '60 days', 'More than 60 days'];

interface JobApplicationFormProps {
  jobToken: string;
  jobData?: {
    years_of_experience?: string | number;
    job_title?: string;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

export default function JobApplicationForm({
  jobToken,
  jobData,
  onSuccess,
  onCancel
}: JobApplicationFormProps) {
  const { submitApplication, isSubmittingApplication, error, clearError } = useCareersStore();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    expectedSalary: '',
    yearsOfExperience: '',
    location: '',
    noticePeriod: '',
    nationality: ''
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const formRef = useRef(formData);
  formRef.current = formData;
  // Autofill from the dropped CV: which fields it filled (and where the value came from), and its status line.
  const [autofillState, setAutofillState] = useState<'idle' | 'reading' | 'done' | 'unreadable'>('idle');
  const [autofilled, setAutofilled] = useState<Record<string, string>>({});
  const [stillToFill, setStillToFill] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [experienceWarning, setExperienceWarning] = useState<{
    show: boolean;
    required: number;
    candidate: number;
    message: string;
  } | null>(null);

  // Create a ref for the file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateForm = () => {
    const errors: Record<string, string> = {};

    // Name validation
    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    } else if (formData.name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters long';
    } else if (!/^[a-zA-Z\s\-'\.]+$/.test(formData.name.trim())) {
      errors.name = 'Name can only contain letters, spaces, hyphens, apostrophes, and periods';
    }

    // Email validation
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email)) {
        errors.email = 'Invalid email format';
      } else {
        // Check for fake email patterns
        const fakeEmailPatterns = [
          /^test@/i,
          /^fake@/i,
          /^dummy@/i,
          /^example@/i,
          /^sample@/i,
          /@test\./i,
          /@fake\./i,
          /@dummy\./i,
          /@example\./i,
          /@sample\./i,
          /123@/,
          /abc@/i,
          /xyz@/i,
          /@123\./,
          /@abc\./i,
          /@xyz\./i
        ];

        if (fakeEmailPatterns.some(pattern => pattern.test(formData.email))) {
          errors.email = 'Please enter a valid business email address';
        }

        // Check for common disposable email domains
        const disposableDomains = [
          '10minutemail.com', 'tempmail.org', 'guerrillamail.com', 'mailinator.com',
          'yopmail.com', 'temp-mail.org', 'throwaway.email', 'getnada.com'
        ];

        const emailDomain = formData.email.split('@')[1]?.toLowerCase();
        if (disposableDomains.includes(emailDomain)) {
          errors.email = 'Please use a permanent email address, not a temporary one';
        }
      }
    }

    // Phone validation
    if (!formData.phone.trim()) {
      errors.phone = 'Phone number is required';
    } else {
      // Remove all non-digit characters for validation
      const phoneDigits = formData.phone.replace(/\D/g, '');

      // Check for fake phone patterns
      const fakePhonePatterns = [
        /^12345+$/,           // 12345, 123456, etc.
        /^00000+$/,           // 00000, 000000, etc.
        /^11111+$/,           // 11111, 111111, etc.
        /^22222+$/,           // 22222, 222222, etc.
        /^33333+$/,           // 33333, 333333, etc.
        /^44444+$/,           // 44444, 444444, etc.
        /^55555+$/,           // 55555, 555555, etc.
        /^66666+$/,           // 66666, 666666, etc.
        /^77777+$/,           // 77777, 777777, etc.
        /^88888+$/,           // 88888, 888888, etc.
        /^99999+$/,           // 99999, 999999, etc.
        /^1234567890$/,       // 1234567890
        /^0987654321$/,       // 0987654321
        /^0123456789$/        // 0123456789
      ];

      if (fakePhonePatterns.some(pattern => pattern.test(phoneDigits))) {
        errors.phone = 'Please enter a valid phone number';
      } else if (phoneDigits.length < 7) {
        errors.phone = 'Phone number must be at least 7 digits long';
      } else if (phoneDigits.length > 15) {
        errors.phone = 'Phone number cannot be longer than 15 digits';
      } else if (!/^[+]?[\d\s\-\(\)]+$/.test(formData.phone)) {
        errors.phone = 'Phone number can only contain digits, spaces, hyphens, parentheses, and + sign';
      }
    }

    // Expected salary validation
    if (!formData.expectedSalary.trim()) {
      errors.expectedSalary = 'Expected salary is required';
    } else {
      const salary = parseFloat(formData.expectedSalary);
      if (isNaN(salary) || salary <= 0) {
        errors.expectedSalary = 'Expected salary must be a positive number';
      }
    }

    // Years of experience validation
    if (!formData.yearsOfExperience.trim()) {
      errors.yearsOfExperience = 'Years of experience is required';
    } else {
      const experience = parseFloat(formData.yearsOfExperience);
      if (isNaN(experience) || experience < 0) {
        errors.yearsOfExperience = 'Years of experience must be a non-negative number';
      }
    }

    // Location validation
    if (!formData.location.trim()) {
      errors.location = 'Location is required';
    }

    // Notice period validation
    if (!formData.noticePeriod) {
      errors.noticePeriod = 'Notice period is required';
    }

    // Nationality validation
    if (!formData.nationality.trim()) {
      errors.nationality = 'Nationality is required';
    }

    if (!selectedFile) {
      errors.file = 'CV file is required';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const sanitizeFieldValue = (field: string, value: string): string => {
    if (field === 'phone') {
      // Digits + common phone punctuation only (no letters)
      return value.replace(/[^\d+\s\-()]/g, '');
    }
    if (field === 'expectedSalary' || field === 'yearsOfExperience') {
      // Digits and at most one decimal point
      const cleaned = value.replace(/[^\d.]/g, '');
      const [whole, ...rest] = cleaned.split('.');
      return rest.length > 0 ? `${whole}.${rest.join('').replace(/\./g, '')}` : whole;
    }
    return value;
  };

  const handleInputChange = (field: string, value: string) => {
    const next = sanitizeFieldValue(field, value);
    setFormData(prev => ({ ...prev, [field]: next }));
    // Once the applicant edits a field themselves it is theirs, no longer "from your CV".
    setAutofilled(prev => {
      if (!(field in prev)) return prev;
      const { [field]: _gone, ...rest } = prev;
      return rest;
    });
    if (formErrors[field]) {
      setFormErrors(prev => ({ ...prev, [field]: '' }));
    }
    clearError();

    // Check experience requirements when years of experience changes
    if (field === 'yearsOfExperience' && jobData?.years_of_experience) {
      checkExperienceRequirements(next);
    }
  };

  const checkExperienceRequirements = (experienceValue: string) => {
    if (!jobData?.years_of_experience || !experienceValue) return;

    const candidateExperience = parseFloat(experienceValue);
    if (isNaN(candidateExperience)) return;

    // Extract required experience from job data
    let requiredExperience = 0;
    if (typeof jobData.years_of_experience === 'number') {
      requiredExperience = jobData.years_of_experience;
    } else if (typeof jobData.years_of_experience === 'string') {
      // Extract number from string like "5 years" or "3-5 years"
      const numbers = jobData.years_of_experience.match(/\d+(?:\.\d+)?/);
      if (numbers) {
        requiredExperience = parseFloat(numbers[0]);
      }
    }

    if (candidateExperience < requiredExperience) {
      setExperienceWarning({
        show: true,
        required: requiredExperience,
        candidate: candidateExperience,
        message: `This job requires ${requiredExperience} years of experience, but you have ${candidateExperience} years.`
      });
    } else {
      setExperienceWarning(null);
    }
  };

  const handleFileSelect = (file: File) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain'
    ];

    if (!allowedTypes.includes(file.type)) {
      setFormErrors(prev => ({
        ...prev,
        file: 'Please upload a PDF, DOC, DOCX, or TXT file'
      }));
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setFormErrors(prev => ({
        ...prev,
        file: 'File size must be less than 10MB'
      }));
      return;
    }

    setSelectedFile(file);
    setFormErrors(prev => ({ ...prev, file: '' }));
    void runAutofill(file);
  };

  const FIELD_LABELS: Record<string, string> = {
    name: 'Full name', email: 'Email', phone: 'Phone', yearsOfExperience: 'Years of experience',
    location: 'Current location', noticePeriod: 'Notice period', nationality: 'Nationality', expectedSalary: 'Expected salary',
  };

  /** Read the CV on the server and fill ONLY empty inputs with values the server is certain about. Never blocks the form. */
  const runAutofill = async (file: File) => {
    setAutofillState('reading');
    setAutofilled({});
    setStillToFill([]);
    try {
      const res = await api.autofillFromCV(jobToken, file);
      if (!res.readable) {
        setAutofillState('unreadable');
        return;
      }
      const accepted: Record<string, string> = {};
      const values: Record<string, string> = {};
      for (const [field, raw] of Object.entries(res.fields || {})) {
        let value = String(raw || '').trim();
        if (field === 'nationality') value = countryFromNationality(value) || '';      // must be a country the picker knows
        if (field === 'noticePeriod' && !NOTICE_PERIOD_OPTIONS.includes(value)) value = '';
        if (value) values[field] = value;
      }
      // Decide from the latest form values (the applicant may have typed while the CV was being read).
      const current = formRef.current as Record<string, string>;
      for (const [field, value] of Object.entries(values)) {
        if (!(field in current) || current[field].trim() !== '') continue;   // never overwrite what was typed
        accepted[field] = res.sources?.[field] || 'your CV';
      }
      setFormData(prev => {
        const next = { ...prev } as Record<string, string>;
        for (const field of Object.keys(accepted)) {
          if ((prev as Record<string, string>)[field].trim() === '') next[field] = values[field];
        }
        return next as typeof prev;
      });
      setAutofilled(accepted);
      const wanted = ['name', 'email', 'phone', 'yearsOfExperience', 'location', 'noticePeriod', 'nationality', 'expectedSalary'];
      setStillToFill(wanted.filter((f) => !(f in accepted)));
      setAutofillState('done');
      if ('yearsOfExperience' in accepted && jobData?.years_of_experience) {
        checkExperienceRequirements(values.yearsOfExperience);
      }
    } catch {
      setAutofillState('unreadable');
    }
  };

  /** Small marker next to a label when its value came from the CV. */
  const fromCv = (field: string) =>
    field in autofilled ? (
      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10.5px] font-medium normal-case tracking-normal text-brand-700" title={autofilled[field]}>
        <Sparkles className="h-3 w-3" /> from your CV, please check
      </span>
    ) : null;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  // Function to handle file input click
  const handleFileInputClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    const result = await submitApplication(
      jobToken,
      formData.name,
      formData.email,
      formData.phone,
      parseFloat(formData.expectedSalary),
      parseFloat(formData.yearsOfExperience),
      selectedFile!,
      formData.location.trim(),
      formData.noticePeriod,
      formData.nationality.trim()
    );

    if (result) {
      setSuccess(true);
      setTimeout(() => {
        onSuccess();
      }, 3000);
    }
  };

  // Shared field classes
  const inputClass = (hasError?: boolean) =>
    `field-input h-10 w-full text-[14px] ${
      hasError
        ? 'border-red-300 focus:border-red-400 focus:ring-red-500/20'
        : ''
    }`;

  if (success) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-white px-6 py-10 text-center shadow-card"
      >
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-emerald-400/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-14 left-1/4 h-36 w-36 rounded-full bg-navy-400/10 blur-3xl" />

        <div className="relative mx-auto mb-5 flex h-20 w-20 items-center justify-center">
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full bg-emerald-100"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          />
          <motion.span
            aria-hidden
            className="absolute inset-[-6px] rounded-full border-2 border-emerald-200/80"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1.08, opacity: [0, 0.9, 0] }}
            transition={{ duration: 1.1, ease: 'easeOut', delay: 0.15 }}
          />
          <svg viewBox="0 0 52 52" className="relative h-12 w-12" aria-hidden>
            <motion.path
              d="M14 27.5 L22.5 35.5 L38 17.5"
              fill="none"
              stroke="#059669"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.55, ease: 'easeOut', delay: 0.22 }}
            />
          </svg>
        </div>

        <motion.h3
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.3 }}
          className="text-[18px] font-bold tracking-[-0.02em] text-slate-900"
        >
          CV submitted
        </motion.h3>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.3 }}
          className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-slate-500"
        >
          Thank you for applying. Our team will review your CV and email you if your profile matches the role.
        </motion.p>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-6"
        >
          <Button variant="primary" onClick={onSuccess}>
            Done
          </Button>
        </motion.div>
      </motion.div>
    );
  }

  const clearSelectedFile = () => {
    setSelectedFile(null);
    setAutofillState('idle');
    setAutofilled({});
    setStillToFill([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Error / already-applied notice */}
      {error && (
        <div
          className={`flex items-start gap-2.5 rounded-lg border p-3 text-[13px] ${
            /already applied|already being processed|already received/i.test(error)
              ? 'border-navy-200 bg-navy-50 text-navy-900'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {/already applied|already being processed|already received/i.test(error) ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-navy-600" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{error}</span>
        </div>
      )}

      {/* Step 1: Upload CV to auto-fill */}
      <section className="rounded-xl border border-navy-100 bg-navy-50/40 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-600 text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-slate-900">Upload CV to fill info</h3>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-600">
              We read your CV and fill the form below. You can still edit every field.
            </p>
          </div>
        </div>

        <input
          type="file"
          accept=".pdf,.doc,.docx,.txt"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
          }}
          className="hidden"
          id="cv-upload"
          ref={fileInputRef}
        />

        {selectedFile ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-surface-border bg-white p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50">
                <FileText className="h-4 w-4 text-brand-600" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-slate-900">{selectedFile.name}</p>
                <p className="text-xs text-slate-500">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  {autofillState === 'reading' ? ' · Reading…' : autofillState === 'done' ? ' · Attached' : ''}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={handleFileInputClick}
                className="rounded-md px-2 py-1 text-xs font-semibold text-navy-700 hover:bg-navy-50"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={clearSelectedFile}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`mt-4 rounded-lg border-2 border-dashed bg-white p-5 text-center transition-colors ${
              dragActive
                ? 'border-brand-400 bg-brand-50/40'
                : formErrors.file
                  ? 'border-red-300 bg-red-50/40'
                  : 'border-slate-300 hover:border-brand-300'
            }`}
            onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <Button
              type="button"
              variant="primary"
              icon={<UploadCloud className="h-4 w-4" />}
              onClick={handleFileInputClick}
            >
              Upload CV to fill info
            </Button>
            <p className="mt-2 text-xs text-slate-500">PDF, DOC, DOCX or TXT · max 10MB · or drop a file here</p>
          </div>
        )}

        {formErrors.file && (
          <p className="mt-2 text-xs text-red-600">{formErrors.file}</p>
        )}

        {autofillState === 'reading' && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[12.5px] text-slate-600 ring-1 ring-slate-200">
            <Loader2 className="h-4 w-4 animate-spin text-navy-600" /> Reading your CV and filling the form…
          </p>
        )}
        {autofillState === 'unreadable' && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 ring-1 ring-amber-100">
            We couldn&apos;t read this CV. Enter your details manually below.
          </p>
        )}
        {autofillState === 'done' && (
          <div className="mt-3 rounded-lg bg-white px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-700 ring-1 ring-brand-100">
            {Object.keys(autofilled).length > 0 ? (
              <p>
                <span className="font-semibold text-brand-700">Filled from your CV:</span>{' '}
                {Object.keys(autofilled).map((f) => FIELD_LABELS[f] || f).join(', ')}. Please check them below.
              </p>
            ) : (
              <p>Nothing was certain from this CV. Enter your details manually below.</p>
            )}
            {stillToFill.length > 0 && Object.keys(autofilled).length > 0 && (
              <p className="mt-1 text-slate-500">
                Still needed: {stillToFill.map((f) => FIELD_LABELS[f] || f).join(', ')}.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Step 2: Form fields — filled from CV or entered manually */}
      <div>
        <div className="mb-3 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <p className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            {autofillState === 'done' && Object.keys(autofilled).length > 0
              ? 'Review extracted info'
              : 'Or enter details manually'}
          </p>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Full name */}
        <div>
          <label className="section-label mb-1.5 block">Full name{fromCv('name')}</label>
          <input
            type="text"
            placeholder="John Doe"
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            className={inputClass(!!formErrors.name)}
          />
          {formErrors.name && (
            <p className="mt-1 text-xs text-red-600">{formErrors.name}</p>
          )}
        </div>

        {/* Email */}
        <div>
          <label className="section-label mb-1.5 block">Email address{fromCv('email')}</label>
          <input
            type="email"
            placeholder="john@company.com"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            className={inputClass(!!formErrors.email)}
          />
          {formErrors.email && (
            <p className="mt-1 text-xs text-red-600">{formErrors.email}</p>
          )}
        </div>

        {/* Phone */}
        <div>
          <label className="section-label mb-1.5 block">Phone number{fromCv('phone')}</label>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+971 50 123 4567"
            value={formData.phone}
            onChange={(e) => handleInputChange('phone', e.target.value)}
            onKeyDown={(e) => {
              if (e.ctrlKey || e.metaKey || e.altKey) return;
              const allowed = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
              if (allowed.includes(e.key)) return;
              if (!/^[0-9+\s\-()]$/.test(e.key)) e.preventDefault();
            }}
            className={inputClass(!!formErrors.phone)}
          />
          {formErrors.phone && (
            <p className="mt-1 text-xs text-red-600">{formErrors.phone}</p>
          )}
        </div>

        {/* Expected salary */}
        <div>
          <label className="section-label mb-1.5 block">Expected monthly salary (AED)</label>
          <input
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.]?[0-9]*"
            placeholder="e.g. 15000"
            value={formData.expectedSalary}
            onChange={(e) => handleInputChange('expectedSalary', e.target.value)}
            onKeyDown={(e) => {
              if (e.ctrlKey || e.metaKey || e.altKey) return;
              const allowed = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
              if (allowed.includes(e.key)) return;
              if (!/^[0-9.]$/.test(e.key)) e.preventDefault();
            }}
            className={inputClass(!!formErrors.expectedSalary)}
          />
          {formErrors.expectedSalary && (
            <p className="mt-1 text-xs text-red-600">{formErrors.expectedSalary}</p>
          )}
        </div>

        {/* Years of experience */}
        <div>
          <label className="section-label mb-1.5 block">Years of experience{fromCv('yearsOfExperience')}</label>
          <input
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.]?[0-9]*"
            placeholder="e.g. 5"
            value={formData.yearsOfExperience}
            onChange={(e) => handleInputChange('yearsOfExperience', e.target.value)}
            onKeyDown={(e) => {
              if (e.ctrlKey || e.metaKey || e.altKey) return;
              const allowed = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
              if (allowed.includes(e.key)) return;
              if (!/^[0-9.]$/.test(e.key)) e.preventDefault();
            }}
            className={inputClass(!!formErrors.yearsOfExperience)}
          />
          {formErrors.yearsOfExperience && (
            <p className="mt-1 text-xs text-red-600">{formErrors.yearsOfExperience}</p>
          )}
        </div>

        {/* Location */}
        <div>
          <label className="section-label mb-1.5 block">Current location{fromCv('location')}</label>
          <LocationAutocomplete
            value={formData.location}
            onChange={(value) => handleInputChange('location', value)}
            placeholder="Start typing a city…"
            hasError={!!formErrors.location}
            className={inputClass(!!formErrors.location)}
          />
          {formErrors.location && (
            <p className="mt-1 text-xs text-red-600">{formErrors.location}</p>
          )}
        </div>

        {/* Notice period */}
        <div>
          <label className="section-label mb-1.5 block">Notice period{fromCv('noticePeriod')}</label>
          <select
            value={formData.noticePeriod}
            onChange={(e) => handleInputChange('noticePeriod', e.target.value)}
            className={inputClass(!!formErrors.noticePeriod)}
          >
            <option value="" disabled>Select notice period…</option>
            {NOTICE_PERIOD_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {formErrors.noticePeriod && (
            <p className="mt-1 text-xs text-red-600">{formErrors.noticePeriod}</p>
          )}
        </div>

        {/* Nationality */}
        <div>
          <label className="section-label mb-1.5 block">Nationality{fromCv('nationality')}</label>
          <NationalityAutocomplete
            value={formData.nationality}
            onChange={(value) => handleInputChange('nationality', value)}
            placeholder="Start typing a country…"
            hasError={!!formErrors.nationality}
            className={inputClass(!!formErrors.nationality)}
          />
          {formErrors.nationality && (
            <p className="mt-1 text-xs text-red-600">{formErrors.nationality}</p>
          )}
        </div>
      </div>
      </div>

      {/* Experience warning modal */}
      {experienceWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4">
          <div className="animate-page-enter w-full max-w-md rounded-xl border border-surface-border bg-white p-6 shadow-[var(--shadow-md)]">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-50">
              <AlertCircle className="h-5 w-5 text-amber-600" />
            </div>
            <h3 className="text-[15px] font-semibold text-slate-900">Experience check</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
              This role typically requires{' '}
              <span className="font-medium text-slate-900">{experienceWarning.required} years</span>.
              You listed{' '}
              <span className="font-medium text-slate-900">{experienceWarning.candidate} years</span>.
              You can still proceed or update your experience.
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setExperienceWarning(null)}
              >
                Edit info
              </Button>
              <Button
                type="button"
                variant="primary"
                className="flex-1"
                onClick={() => setExperienceWarning(null)}
              >
                Proceed
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Submit buttons */}
      <div className="flex items-center justify-end gap-2 border-t border-surface-border pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          icon={<Upload className="h-4 w-4" />}
          loading={isSubmittingApplication}
        >
          Submit application
        </Button>
      </div>
    </form>
  );
}
