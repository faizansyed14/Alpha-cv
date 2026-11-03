'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { Button } from '@/components/ui/button';
import { AlertCircle, X, Eye, EyeOff, Lock, User, Mail, KeyRound, ArrowLeft, ShieldCheck, RefreshCw } from '@/components/icons';

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

  // CAPTCHA state
  const [captchaId, setCaptchaId] = useState<string>('');
  const [captchaImage, setCaptchaImage] = useState<string>('');
  const [captchaAnswer, setCaptchaAnswer] = useState<string>('');
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const [submittingCaptcha, setSubmittingCaptcha] = useState(false);

  const [formData, setFormData] = useState({ username: '', password: '', otp: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // If username/password changes, invalidate the "OTP already issued" marker
  useEffect(() => {
    const key = `${formData.username}::${formData.password}`;
    if (otpIssuedForKey && otpIssuedForKey !== key) {
      setOtpIssuedForKey(null);
      setOtpSent(false);
      setUserEmail('');
      setFormData(prev => ({ ...prev, otp: '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.username, formData.password]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (error) clearError();
    if (formError) setFormError(null);
  };

  const handlePasswordVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingPassword) return;

    if (!formData.username.trim()) { setFormError('Username is required'); return; }
    if (!formData.password.trim()) { setFormError('Password is required'); return; }

    try {
      setSubmittingPassword(true);
      const result = await verifyPassword(formData.username, formData.password);

      if (result && result.success) {
        if (result.requires_otp === false) {
          // Admin user - login directly (no second factor)
          setFormError(null);
          const loginResult = await login(formData.username, formData.password);
          if (loginResult && loginResult.success) continueAfterAuth();
          return;
        } else if (result.auth_mode === 'captcha') {
          // CAPTCHA-mode user - load an image challenge
          setFormError(null);
          await loadCaptcha();
          setStep('captcha');
        } else {
          // Email OTP user - send OTP automatically
          setFormError(null);
          const key = `${formData.username}::${formData.password}`;
          if (otpIssuedForKey === key && otpSent) { setStep('otp'); return; }

          const otpResult = await sendOTP(formData.username, formData.password);
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
      const res = await getCaptcha(formData.username, formData.password);
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
    if (!captchaAnswer.trim()) { setFormError('Enter the characters shown'); return; }
    try {
      setSubmittingCaptcha(true);
      const res = await verifyCaptcha(formData.username, captchaId, captchaAnswer.trim());
      if (res && res.success) {
        continueAfterAuth();
      } else {
        // wrong/expired answer, refresh the challenge so they get a new image
        await loadCaptcha();
      }
    } finally {
      setSubmittingCaptcha(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingOtp) return;
    if (!formData.otp.trim()) { setFormError('OTP is required'); return; }
    if (formData.otp.length !== 6) { setFormError('OTP must be 6 digits'); return; }

    try {
      setSubmittingOtp(true);
      const result = await verifyOTP(formData.username, formData.otp);
      if (result && result.success) continueAfterAuth();
    } finally {
      setSubmittingOtp(false);
    }
  };

  const handleResendOTP = async () => {
    setOtpSent(false);
    setFormData(prev => ({ ...prev, otp: '' }));
    const result = await sendOTP(formData.username, formData.password);
    if (result && result.success) {
      setOtpSent(true);
      setOtpIssuedForKey(`${formData.username}::${formData.password}`);
      setFormError(null);
    }
  };

  const displayError = formError || error;

  return (
    <div className="grid min-h-screen w-full bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-navy-700 via-navy-800 to-navy-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-navy-400/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-navy-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white p-1.5">
            <img src="/alphadatalogo.svg" alt="" className="h-full w-full object-contain" />
          </span>
          <span className="text-xl font-bold tracking-[-0.03em]">Alpha<span className="text-navy-200">CV</span></span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-[34px] font-bold leading-[1.15] tracking-[-0.03em]">Find the right candidate in minutes, not days.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-navy-100/90">
            Rank thousands of CVs against a job description, review the best fits with AI, and move them through hiring in one place.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            {['Semantic matching on skills, responsibilities and experience', 'AI review of the strongest candidates', 'Careers pages, applicants and a hiring tracker'].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <ShieldCheck className="h-3 w-3" />
                </span>
                <span className="text-navy-50">{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-navy-200/80">Alpha Data Recruitment</p>
      </aside>

      <div className="flex items-center justify-center bg-[var(--app-bg)] px-4 py-12 lg:bg-white">
      <div className="w-full max-w-[380px] animate-page-enter">
        {/* Brand */}
        <div className="mb-8">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <img src="/alphadatalogo.svg" alt="Alpha Data" className="h-9 w-9 rounded-lg object-contain" />
            <span className="text-lg font-bold tracking-[-0.03em] text-slate-900">Alpha<span className="text-navy-600">CV</span></span>
          </div>
          <h1 className="text-2xl font-bold tracking-[-0.025em] text-slate-900">Welcome back</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Sign in to your recruitment workspace.
          </p>
        </div>

        {/* Card */}
        <div>
          {displayError && (
            <div className="mb-4 flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" />
                <span className="text-[13px] font-medium text-danger-700">{displayError}</span>
              </div>
              <button
                type="button"
                onClick={() => { clearError(); setFormError(null); }}
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
                <label htmlFor="username" className="block text-[13px] font-semibold text-slate-700">
                  Username
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="username"
                    name="username"
                    type="text"
                    value={formData.username}
                    onChange={handleInputChange}
                    placeholder="Enter your username"
                    disabled={loading}
                    required
                    autoComplete="username"
                    className="h-11 w-full rounded-lg border border-surface-strong bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-soft transition-[border-color,box-shadow] hover:border-slate-300 focus:border-navy-500 focus:shadow-glow focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="block text-[13px] font-semibold text-slate-700">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={handleInputChange}
                    placeholder="Enter your password"
                    disabled={loading}
                    required
                    autoComplete="current-password"
                    className="h-11 w-full rounded-lg border border-surface-strong bg-white pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-400 shadow-soft transition-[border-color,box-shadow] hover:border-slate-300 focus:border-navy-500 focus:shadow-glow focus:outline-none disabled:opacity-50"
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

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={loading || submittingPassword}
              >
                Continue
              </Button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleVerifyOTP} className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-navy-100 bg-navy-50 px-3.5 py-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-brand-900">
                    Verification code sent to {userEmail || 'your registered email'}
                  </p>
                  <p className="mt-0.5 text-xs text-brand-600/80">Valid for 5 minutes.</p>
                  <button
                    type="button"
                    onClick={handleResendOTP}
                    className="mt-1.5 text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50"
                    disabled={loading || submittingOtp}
                  >
                    Resend code
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="otp" className="block text-[13px] font-semibold text-slate-700">
                  Verification code
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="otp"
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    value={formData.otp}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setFormData(prev => ({ ...prev, otp: value }));
                      if (error) clearError();
                      if (formError) setFormError(null);
                    }}
                    placeholder="000000"
                    disabled={loading}
                    required
                    maxLength={6}
                    pattern="[0-9]{6}"
                    className="h-11 w-full rounded-lg border border-surface-strong bg-white pl-9 pr-3 text-center text-lg font-semibold tracking-[0.4em] text-slate-900 placeholder-gray-300 transition-colors focus:border-navy-500 focus:shadow-glow focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={loading || submittingOtp}
              >
                Verify &amp; sign in
              </Button>

              <button
                type="button"
                onClick={() => {
                  setStep('password');
                  setFormData(prev => ({ ...prev, otp: '' }));
                  setFormError(null);
                }}
                className="flex w-full items-center justify-center gap-1.5 py-1 text-[13px] text-slate-500 transition-colors hover:text-slate-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            </form>
          )}

          {step === 'captcha' && (
            <form onSubmit={handleVerifyCaptcha} className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-navy-100 bg-navy-50 px-3.5 py-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <p className="text-[13px] font-medium text-brand-900">
                  Type the characters shown in the image to continue.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[13px] font-semibold text-slate-700">Security check</label>
                <div className="flex items-center gap-2">
                  <div className="flex h-[80px] flex-1 items-center justify-center overflow-hidden rounded-md border border-surface-strong bg-slate-50">
                    {loadingCaptcha || !captchaImage ? (
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-surface-strong border-t-brand-600" />
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
                    className="flex h-10 w-10 items-center justify-center rounded-md border border-surface-strong bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-brand-600 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingCaptcha ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="captcha" className="block text-[13px] font-semibold text-slate-700">
                  Enter the characters
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="captcha"
                    name="captcha"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    value={captchaAnswer}
                    onChange={(e) => { setCaptchaAnswer(e.target.value.toUpperCase()); if (error) clearError(); if (formError) setFormError(null); }}
                    placeholder="ABC123"
                    disabled={loading}
                    required
                    className="h-11 w-full rounded-lg border border-surface-strong bg-white pl-9 pr-3 text-center text-lg font-semibold uppercase tracking-[0.3em] text-slate-900 placeholder-gray-300 transition-colors focus:border-navy-500 focus:shadow-glow focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <Button type="submit" variant="primary" className="w-full" loading={loading || submittingCaptcha}>
                Verify &amp; sign in
              </Button>

              <button
                type="button"
                onClick={() => { setStep('password'); setCaptchaAnswer(''); setFormError(null); }}
                className="flex w-full items-center justify-center gap-1.5 py-1 text-[13px] text-slate-500 transition-colors hover:text-slate-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            </form>
          )}
        </div>

        <p className="mt-8 text-[13px] text-slate-500">
          Need an account? Contact your administrator.
        </p>
      </div>
      </div>
    </div>
  );
}
