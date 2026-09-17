'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { Button } from '@/components/ui/button';
import { AlertCircle, X, Eye, EyeOff, Lock, User, Mail, KeyRound, ArrowLeft, ShieldCheck, RefreshCw } from 'lucide-react';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyPassword, sendOTP, verifyOTP, getCaptcha, verifyCaptcha, login, loading, error, clearError } = useAuthStore();

  const continueAfterAuth = () => {
    const from = safeRedirectPath(searchParams.get('from'));
    router.push(from ?? '/');
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
        // wrong/expired answer — refresh the challenge so they get a new image
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
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F7F8FA] px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-gray-200 bg-white p-2 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <img src="/alphadatalogo.svg" alt="Alpha Data" className="h-full w-full object-contain" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Sign in to Alpha CV</h1>
          <p className="mt-1 text-[13px] text-gray-500">
            AI-powered recruitment platform
          </p>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          {displayError && (
            <div className="mb-4 flex items-start justify-between gap-2 rounded-md border border-danger-200 bg-danger-50 px-3 py-2.5">
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
                <label htmlFor="username" className="block text-[13px] font-medium text-gray-700">
                  Username
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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
                    className="h-9 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-[13px] text-gray-900 placeholder-gray-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="block text-[13px] font-medium text-gray-700">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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
                    className="h-9 w-full rounded-md border border-gray-200 bg-white pl-9 pr-9 text-[13px] text-gray-900 placeholder-gray-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={loading || submittingPassword}
              >
                Continue
              </Button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleVerifyOTP} className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-md border border-brand-200 bg-brand-50 px-3 py-2.5">
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
                <label htmlFor="otp" className="block text-[13px] font-medium text-gray-700">
                  Verification code
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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
                    className="h-11 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-center text-lg font-semibold tracking-[0.4em] text-gray-900 placeholder-gray-300 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50"
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
                className="flex w-full items-center justify-center gap-1.5 py-1 text-[13px] text-gray-500 transition-colors hover:text-gray-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            </form>
          )}

          {step === 'captcha' && (
            <form onSubmit={handleVerifyCaptcha} className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-md border border-brand-200 bg-brand-50 px-3 py-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <p className="text-[13px] font-medium text-brand-900">
                  Type the characters shown in the image to continue.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[13px] font-medium text-gray-700">Security check</label>
                <div className="flex items-center gap-2">
                  <div className="flex h-[80px] flex-1 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                    {loadingCaptcha || !captchaImage ? (
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-brand-600" />
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
                    className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-brand-600 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingCaptcha ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="captcha" className="block text-[13px] font-medium text-gray-700">
                  Enter the characters
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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
                    className="h-11 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-center text-lg font-semibold uppercase tracking-[0.3em] text-gray-900 placeholder-gray-300 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50"
                  />
                </div>
              </div>

              <Button type="submit" variant="primary" className="w-full" loading={loading || submittingCaptcha}>
                Verify &amp; sign in
              </Button>

              <button
                type="button"
                onClick={() => { setStep('password'); setCaptchaAnswer(''); setFormError(null); }}
                className="flex w-full items-center justify-center gap-1.5 py-1 text-[13px] text-gray-500 transition-colors hover:text-gray-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[13px] text-gray-400">
          Need an account? Contact your administrator.
        </p>
      </div>
    </div>
  );
}
