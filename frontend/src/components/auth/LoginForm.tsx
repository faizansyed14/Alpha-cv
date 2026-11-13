'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { Button } from '@/components/ui/button';
import { AlertCircle, X, Eye, EyeOff, ArrowLeft, RefreshCw, ShieldCheck } from '@/components/icons';
import { ease } from '@/lib/motion';

const fieldClass =
  'h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[0.95rem] text-slate-900 placeholder:text-slate-400 transition-[border-color,box-shadow] hover:border-slate-300 focus:border-navy-500 focus:shadow-glow focus:outline-none disabled:opacity-50';

// A faint film-grain texture: the detail that reads as "crafted" on a dark surface, never as a stock gradient.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

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
    step === 'otp' ? 'Check your email' : step === 'captcha' ? 'Security check' : 'Welcome back';
  const subtitle =
    step === 'otp'
      ? `We sent a 6-digit code to ${userEmail || 'your email'}.`
      : step === 'captcha'
        ? 'Enter the characters shown to confirm it is you.'
        : 'Sign in to your recruitment workspace.';

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_minmax(0,1fr)]">
      {/* ------------------------------------------------------------------ brand panel */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden px-14 py-12 text-white lg:flex"
        style={{
          background:
            'radial-gradient(1100px 520px at 50% -18%, rgba(255,255,255,0.10), transparent 60%),' +
            'radial-gradient(760px 520px at 108% 112%, rgba(99,110,240,0.16), transparent 62%),' +
            'linear-gradient(162deg, #0a1030 0%, #111a40 54%, #0b1230 100%)',
        }}
      >
        {/* architectural hairline grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
            maskImage: 'radial-gradient(120% 120% at 50% 0%, #000 35%, transparent 90%)',
            WebkitMaskImage: 'radial-gradient(120% 120% at 50% 0%, #000 35%, transparent 90%)',
          }}
        />
        {/* grain */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.045] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
        {/* a single slow, barely-there light drift */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-10 h-[460px] w-[460px] rounded-full bg-iris-500/10 blur-[120px]"
          animate={{ opacity: [0.5, 0.8, 0.5], y: [0, 26, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />

        <div className="relative flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/95 shadow-sm">
            <img src="/alphadatalogo.svg" alt="" className="h-5 w-5 object-contain" />
          </span>
          <span className="text-[0.95rem] font-semibold tracking-[-0.01em]">AlphaData</span>
          <span className="ml-1 h-3.5 w-px bg-white/20" />
          <span className="text-2xs font-medium uppercase tracking-[0.2em] text-white/50">Recruitment</span>
        </div>

        <div className="relative max-w-[30rem]">
          <h2 className="font-display text-[2.6rem] font-semibold leading-[1.08] tracking-[-0.035em] text-white">
            The clearest view of<br />every candidate you have.
          </h2>
          <p className="mt-6 max-w-sm text-[0.95rem] leading-relaxed text-white/60">
            Search, match and shortlist with explainable AI, on a workspace your team can trust.
          </p>
        </div>

        <div className="relative border-t border-white/10 pt-6 text-xs text-white/40">
          <span>© {new Date().getFullYear()} AlphaData Recruitment</span>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ form */}
      <div className="relative flex min-h-screen flex-col bg-white">
        <div className="relative flex h-16 items-center justify-between px-6 sm:px-10">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="Back to home"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <span className="flex items-center gap-2.5 lg:hidden">
            <img src="/alphadatalogo.svg" alt="" className="h-6 w-6 object-contain" />
            <span className="font-display text-base font-semibold tracking-[-0.02em] text-slate-900">AlphaData</span>
          </span>
          <span className="w-14" aria-hidden />
        </div>

        <motion.main
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease }}
          className="relative flex flex-1 items-center justify-center px-6 pb-20 sm:px-10"
        >
          <div className="w-full max-w-[384px]">
            <div className="mb-8">
              <h1 className="font-display text-[1.9rem] font-semibold leading-tight tracking-[-0.035em] text-slate-900">{title}</h1>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-slate-500">{subtitle}</p>
              <div className="mt-5 flex items-center gap-2">
                <span className="h-[3px] w-9 rounded-full bg-navy-800" />
                <span className={`h-[3px] w-9 rounded-full transition-colors ${step !== 'password' ? 'bg-navy-800' : 'bg-slate-200'}`} />
                <span className="ml-1.5 text-2xs font-medium uppercase tracking-[0.14em] text-slate-400">
                  {step === 'password' ? 'Step 1 of 2' : 'Step 2 of 2'}
                </span>
              </div>
            </div>

            {displayError && (
              <div className="mb-5 flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50/80 px-4 py-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span className="text-sm font-medium text-red-700">{displayError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearError();
                    setFormError(null);
                  }}
                  className="rounded p-0.5 text-red-500 hover:bg-red-100"
                  aria-label="Dismiss error"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
              {step === 'password' && (
                <form onSubmit={handlePasswordVerify} className="space-y-5">
                  <div className="space-y-2">
                    <label htmlFor="email" className="block text-sm font-medium text-slate-700">
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

                  <div className="space-y-2">
                    <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                      Password
                    </label>
                    <div className="relative">
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
                        className={`${fieldClass} pr-11`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
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
                <form onSubmit={handleVerifyOTP} className="space-y-5">
                  <div className="space-y-2">
                    <label htmlFor="otp" className="block text-sm font-medium text-slate-700">
                      Verification code
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
                      className={`${fieldClass} text-center text-xl font-semibold tracking-[0.5em]`}
                    />
                  </div>

                  <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading || submittingOtp}>
                    Verify &amp; sign in
                  </Button>

                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setStep('password');
                        setFormData((prev) => ({ ...prev, otp: '' }));
                        setFormError(null);
                      }}
                      className="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-800"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" /> Back
                    </button>
                    <button
                      type="button"
                      onClick={handleResendOTP}
                      className="text-sm font-semibold text-navy-700 transition-opacity hover:opacity-70 disabled:opacity-50"
                      disabled={loading || submittingOtp}
                    >
                      Resend code
                    </button>
                  </div>
                </form>
              )}

              {step === 'captcha' && (
                <form onSubmit={handleVerifyCaptcha} className="space-y-5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-[84px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                      {loadingCaptcha || !captchaImage ? (
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-navy-600" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={captchaImage} alt="CAPTCHA" className="h-[84px] w-full object-contain" />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={loadCaptcha}
                      disabled={loadingCaptcha}
                      title="Get a new image"
                      aria-label="Refresh CAPTCHA"
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-navy-700 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${loadingCaptcha ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="captcha" className="block text-sm font-medium text-slate-700">
                      Characters shown
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
                      className={`${fieldClass} text-center text-lg font-semibold uppercase tracking-[0.35em]`}
                    />
                  </div>

                  <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading || submittingCaptcha}>
                    Verify &amp; sign in
                  </Button>

                  <button
                    type="button"
                    onClick={() => {
                      setStep('password');
                      setCaptchaAnswer('');
                      setFormError(null);
                    }}
                    className="flex w-full items-center justify-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                </form>
              )}
            </motion.div>

            <div className="mt-8 flex items-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Secured with two-step verification</span>
            </div>
          </div>
        </motion.main>
      </div>
    </div>
  );
}
