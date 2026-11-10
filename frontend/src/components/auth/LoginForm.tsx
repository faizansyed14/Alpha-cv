'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { Button } from '@/components/ui/button';
import { AlertCircle, X, Eye, EyeOff, ArrowLeft, RefreshCw } from '@/components/icons';
import { ease, rise } from '@/lib/motion';

const fieldClass =
  'h-11 w-full rounded-xl border border-white/80 bg-white/90 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-[var(--shadow-card)] backdrop-blur-sm transition-[border-color,box-shadow] hover:border-navy-200 focus:border-navy-500 focus:shadow-glow focus:outline-none disabled:opacity-50';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyPassword, sendOTP, verifyOTP, getCaptcha, verifyCaptcha, login, loading, error, clearError } = useAuthStore();

  const continueAfterAuth = () => {
    const from = safeRedirectPath(searchParams.get('from'));
    router.push(from ?? '/dashboard');
  };

  const [step, setStep] = useState<'password' | 'otp' | 'captcha'>('password');
  const [otpSent, setOtpSent] = useState(false);
  const [otpIssuedForKey, setOtpIssuedForKey] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [submittingPassword, setSubmittingPassword] = useState(false);
  const [submittingOtp, setSubmittingOtp] = useState(false);

  const [captchaId, setCaptchaId] = useState<string>('');
  const [captchaImage, setCaptchaImage] = useState<string>('');
  const [captchaAnswer, setCaptchaAnswer] = useState<string>('');
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const [submittingCaptcha, setSubmittingCaptcha] = useState(false);

  const [formData, setFormData] = useState({ email: '', password: '', otp: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const key = `${formData.email}::${formData.password}`;
    if (otpIssuedForKey && otpIssuedForKey !== key) {
      setOtpIssuedForKey(null);
      setOtpSent(false);
      setUserEmail('');
      setFormData((prev) => ({ ...prev, otp: '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.email, formData.password]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) clearError();
    if (formError) setFormError(null);
  };

  const handlePasswordVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingPassword) return;

    if (!formData.email.trim()) {
      setFormError('Email is required');
      return;
    }
    if (!formData.password.trim()) {
      setFormError('Password is required');
      return;
    }

    try {
      setSubmittingPassword(true);
      const result = await verifyPassword(formData.email, formData.password);

      if (result && result.success) {
        if (result.requires_otp === false) {
          setFormError(null);
          const loginResult = await login(formData.email, formData.password);
          if (loginResult && loginResult.success) continueAfterAuth();
          return;
        } else if (result.auth_mode === 'captcha') {
          setFormError(null);
          await loadCaptcha();
          setStep('captcha');
        } else {
          setFormError(null);
          const key = `${formData.email}::${formData.password}`;
          if (otpIssuedForKey === key && otpSent) {
            setStep('otp');
            return;
          }

          const otpResult = await sendOTP(formData.email, formData.password);
          if (otpResult && otpResult.success) {
            setOtpSent(true);
            setOtpIssuedForKey(key);
            setStep('otp');
            setUserEmail(otpResult.masked_email || 'your registered email');
          }
        }
      }
    } finally {
      setSubmittingPassword(false);
    }
  };

  const loadCaptcha = async () => {
    setLoadingCaptcha(true);
    setCaptchaAnswer('');
    try {
      const res = await getCaptcha(formData.email, formData.password);
      if (res && res.success && res.captcha_id && res.image) {
        setCaptchaId(res.captcha_id);
        setCaptchaImage(res.image);
        setFormError(null);
      } else {
        setFormError(res?.error || 'Failed to load CAPTCHA');
      }
    } finally {
      setLoadingCaptcha(false);
    }
  };

  const handleVerifyCaptcha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingCaptcha) return;
    if (!captchaAnswer.trim()) {
      setFormError('Enter the characters shown');
      return;
    }
    try {
      setSubmittingCaptcha(true);
      const res = await verifyCaptcha(formData.email, captchaId, captchaAnswer.trim());
      if (res && res.success) {
        continueAfterAuth();
      } else {
        await loadCaptcha();
      }
    } finally {
      setSubmittingCaptcha(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingOtp) return;
    if (!formData.otp.trim()) {
      setFormError('OTP is required');
      return;
    }
    if (formData.otp.length !== 6) {
      setFormError('OTP must be 6 digits');
      return;
    }

    try {
      setSubmittingOtp(true);
      const result = await verifyOTP(formData.email, formData.otp);
      if (result && result.success) continueAfterAuth();
    } finally {
      setSubmittingOtp(false);
    }
  };

  const handleResendOTP = async () => {
    setOtpSent(false);
    setFormData((prev) => ({ ...prev, otp: '' }));
    const result = await sendOTP(formData.email, formData.password);
    if (result && result.success) {
      setOtpSent(true);
      setOtpIssuedForKey(`${formData.email}::${formData.password}`);
      setFormError(null);
    }
  };

  const displayError = formError || error;
  const title =
    step === 'otp' ? 'Check your email' : step === 'captcha' ? 'Security check' : 'Sign in';
  const subtitle =
    step === 'otp'
      ? `Code sent to ${userEmail || 'your email'}`
      : step === 'captcha'
        ? 'Enter the characters in the image'
        : 'AlphaData recruitment';

  return (
    <div className="relative flex min-h-screen flex-col bg-gradient-to-br from-navy-50 via-sky-50/40 to-[#EEF3FA]">
      <div aria-hidden className="pointer-events-none absolute -left-20 top-10 h-56 w-56 rounded-full bg-sky-300/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-16 bottom-20 h-64 w-64 rounded-full bg-navy-400/15 blur-3xl" />

      <header className="relative z-10 border-b border-white/60 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-white/80 hover:text-navy-800"
            aria-label="Back to marketing page"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex items-center gap-3">
            <img src="/alphadatalogo.svg" alt="" className="h-8 w-8 object-contain" />
            <span className="leading-tight">
              <span className="block text-md font-semibold tracking-[-0.02em] text-ink">AlphaData</span>
              <span className="block text-2xs font-semibold uppercase tracking-[0.12em] text-slate-400">Recruitment</span>
            </span>
          </div>
          <div className="w-16" aria-hidden />
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
        className="relative z-10 flex flex-1 items-center justify-center px-4 py-12 sm:px-6"
      >
        <motion.div variants={rise} initial="hidden" animate="show" className="w-full max-w-[400px]">
          <div className="mb-8 text-center">
            <p className="mb-4 inline-flex rounded-full border border-white/80 bg-white/80 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-700 shadow-[var(--shadow-card)] backdrop-blur">
              Workspace
            </p>
            <h1 className="text-[28px] font-bold tracking-[-0.03em] text-slate-900 sm:text-[32px]">{title}</h1>
            <p className="mt-2 text-[14px] text-slate-500">{subtitle}</p>
          </div>

          <div className="rounded-3xl border border-white/80 bg-white/80 p-6 shadow-[var(--shadow-card)] backdrop-blur-md sm:p-8">
            {displayError && (
              <div className="mb-4 flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50/90 px-3.5 py-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" />
                  <span className="text-[13px] font-medium text-danger-700">{displayError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearError();
                    setFormError(null);
                  }}
                  className="rounded p-0.5 text-danger-500 hover:bg-danger-100"
                  aria-label="Dismiss error"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {step === 'password' && (
              <form onSubmit={handlePasswordVerify} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="email" className="block text-[12px] font-semibold text-slate-600">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="text"
                    inputMode="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="you@company.com"
                    disabled={loading}
                    required
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    className={fieldClass}
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="password" className="block text-[12px] font-semibold text-slate-600">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={handleInputChange}
                      placeholder="Password"
                      disabled={loading}
                      required
                      autoComplete="current-password"
                      className={`${fieldClass} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading || submittingPassword}>
                  Continue
                </Button>
              </form>
            )}

            {step === 'otp' && (
              <form onSubmit={handleVerifyOTP} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="otp" className="block text-[12px] font-semibold text-slate-600">
                    6-digit code
                  </label>
                  <input
                    id="otp"
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    value={formData.otp}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setFormData((prev) => ({ ...prev, otp: value }));
                      if (error) clearError();
                      if (formError) setFormError(null);
                    }}
                    placeholder="000000"
                    disabled={loading}
                    required
                    maxLength={6}
                    pattern="[0-9]{6}"
                    className={`${fieldClass} text-center text-lg font-semibold tracking-[0.4em]`}
                  />
                </div>

                <Button type="submit" variant="primary" className="w-full" loading={loading || submittingOtp}>
                  Verify &amp; sign in
                </Button>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('password');
                      setFormData((prev) => ({ ...prev, otp: '' }));
                      setFormError(null);
                    }}
                    className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-700"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                  <button
                    type="button"
                    onClick={handleResendOTP}
                    className="text-[13px] font-semibold text-navy-700 hover:underline disabled:opacity-50"
                    disabled={loading || submittingOtp}
                  >
                    Resend
                  </button>
                </div>
              </form>
            )}

            {step === 'captcha' && (
              <form onSubmit={handleVerifyCaptcha} className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-[80px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-white/80 bg-white/90 shadow-[var(--shadow-card)]">
                    {loadingCaptcha || !captchaImage ? (
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-surface-strong border-t-navy-600" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={captchaImage} alt="CAPTCHA" className="h-[80px] w-full object-contain" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={loadCaptcha}
                    disabled={loadingCaptcha}
                    title="Get a new image"
                    aria-label="Refresh CAPTCHA"
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/80 bg-white/90 text-slate-500 shadow-[var(--shadow-card)] transition-colors hover:text-navy-700 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingCaptcha ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="captcha" className="block text-[12px] font-semibold text-slate-600">
                    Characters
                  </label>
                  <input
                    id="captcha"
                    name="captcha"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    value={captchaAnswer}
                    onChange={(e) => {
                      setCaptchaAnswer(e.target.value.toUpperCase());
                      if (error) clearError();
                      if (formError) setFormError(null);
                    }}
                    placeholder="ABC123"
                    disabled={loading}
                    required
                    className={`${fieldClass} text-center text-lg font-semibold uppercase tracking-[0.3em]`}
                  />
                </div>

                <Button type="submit" variant="primary" className="w-full" loading={loading || submittingCaptcha}>
                  Verify &amp; sign in
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setStep('password');
                    setCaptchaAnswer('');
                    setFormError(null);
                  }}
                  className="flex w-full items-center justify-center gap-1.5 py-1 text-[13px] text-slate-500 hover:text-slate-700"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
              </form>
            )}
          </div>
        </motion.div>
      </motion.main>
    </div>
  );
}
