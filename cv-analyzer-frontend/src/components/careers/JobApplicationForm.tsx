'use client';
import React, { useState, useRef } from 'react';
import {
  Upload,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';
import { useCareersStore } from '@/stores/careersStore';
import { Button } from '@/components/ui/button';
import LocationAutocomplete from '@/components/common/LocationAutocomplete';
import NationalityAutocomplete from '@/components/common/NationalityAutocomplete';

// Keep in sync with NOTICE_PERIOD_OPTIONS in alpha-backend/app/schemas/careers.py
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
  };

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
      <div className="surface-panel p-6 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-success-50">
          <CheckCircle2 className="h-5 w-5 text-success-600" />
        </div>
        <h3 className="text-[15px] font-semibold text-slate-900">Application received</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-slate-500">
          Thank you for applying. Our recruitment team will review your CV and reach out by email
          if your profile matches the role.
        </p>
        <Button variant="primary" className="mt-4" onClick={onSuccess}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Full name */}
        <div>
          <label className="section-label mb-1.5 block">Full name</label>
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
          <label className="section-label mb-1.5 block">Email address</label>
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
          <label className="section-label mb-1.5 block">Phone number</label>
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
          <label className="section-label mb-1.5 block">Years of experience</label>
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
          <label className="section-label mb-1.5 block">Current location</label>
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
          <label className="section-label mb-1.5 block">Notice period</label>
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
          <label className="section-label mb-1.5 block">Nationality</label>
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

      {/* CV Upload */}
      <div>
        <label className="section-label mb-1.5 block">CV / Resume</label>
        {selectedFile ? (
          <div className="surface-panel flex items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50">
                <FileText className="h-4 w-4 text-brand-600" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-slate-900">{selectedFile.name}</p>
                <p className="text-xs text-slate-500">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB · Ready to upload
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="inline-flex items-center gap-1 rounded p-1 text-xs font-medium text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-red-600"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div
            className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              dragActive
                ? 'border-brand-400 bg-brand-50/40'
                : formErrors.file
                ? 'border-red-300 bg-red-50/40'
                : 'border-slate-300 hover:border-brand-300 hover:bg-slate-50'
            }`}
            onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100">
              <UploadCloud className="h-5 w-5 text-slate-400" />
            </div>
            <p className="text-[13px] font-medium text-slate-900">
              Drop your CV here or{' '}
              <button
                type="button"
                onClick={handleFileInputClick}
                className="font-semibold text-brand-600 hover:underline"
              >
                browse files
              </button>
            </p>
            <p className="mt-1 text-xs text-slate-500">PDF, DOC, DOCX or TXT · max 10MB</p>
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
          </div>
        )}
        {formErrors.file && (
          <p className="mt-1 text-xs text-red-600">{formErrors.file}</p>
        )}
      </div>

      {/* Experience warning modal */}
      {experienceWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4">
          <div className="animate-page-enter w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-[var(--shadow-md)]">
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
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
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
