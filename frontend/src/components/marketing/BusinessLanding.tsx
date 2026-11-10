'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { rise, stagger } from '@/lib/motion';
import HeroDashboardPreview from '@/components/marketing/HeroDashboardPreview';

const ProductTour = dynamic(() => import('@/components/demo/ProductTour'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[92dvh] items-center justify-center bg-white text-[13px] text-slate-500">
      Loading product tour…
    </div>
  ),
});

const FEATURES = [
  {
    id: 'match',
    eyebrow: 'Match',
    title: 'Ranked shortlists.',
    sub: 'Score talent against any JD.',
    img: '/marketing/alphacv-match-ai.jpg',
    imgAlt: 'Recruiter reviewing match scores on a laptop',
  },
  {
    id: 'candidates',
    eyebrow: 'Candidates',
    title: 'Your talent pool.',
    sub: 'Browse, filter, open every CV.',
    img: '/marketing/alphacv-candidates.jpg',
    imgAlt: 'Happy professionals collaborating',
  },
  {
    id: 'careers',
    eyebrow: 'Careers',
    title: 'Post. Attract. Hire.',
    sub: 'Public openings with AI apply autofill.',
    img: '/marketing/alphacv-careers.jpg',
    imgAlt: 'Candidate applying for a role on a tablet',
  },
] as const;

export default function BusinessLanding() {
  const [demoReady, setDemoReady] = useState(false);
  const [tourKey, setTourKey] = useState(0);
  const demoSectionRef = useRef<HTMLElement>(null);

  // Stay at top on first paint; ignore leftover #demo hash from a prior visit
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    window.scrollTo(0, 0);
  }, []);

  // Mount the tour only after the demo block is actually on screen
  useEffect(() => {
    const el = demoSectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setDemoReady(true);
      },
      { root: null, rootMargin: '0px', threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const scrollToTop = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const scrollToDemo = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    demoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setDemoReady(true);
  }, []);

  const watchFromStart = useCallback(() => {
    setDemoReady(true);
    setTourKey((k) => k + 1);
    demoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div id="top" className="min-h-dvh bg-white text-slate-900" style={{ fontFamily: 'var(--font-sans)' }}>
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="#top" onClick={scrollToTop} className="flex items-center gap-2.5" aria-label="AlphaCV home">
            <img src="/alphadatalogo.svg" alt="" className="h-7 w-7 object-contain" />
            <span className="text-[15px] font-semibold tracking-[-0.02em]">
              Alpha<span className="text-navy-700">CV</span>
            </span>
          </a>
          <nav className="hidden items-center gap-7 text-[12px] font-medium text-slate-600 sm:flex">
            <a href="#product" className="hover:text-slate-900">Product</a>
            <a href="#about" className="hover:text-slate-900">About</a>
            <a href="#demo" onClick={scrollToDemo} className="hover:text-slate-900">Demo</a>
          </nav>
          <Link
            href="/login"
            className="inline-flex h-8 items-center rounded-full bg-navy-900 px-4 text-[12px] font-semibold text-white hover:bg-navy-800"
          >
            Login
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden bg-white">
        <div className="mx-auto max-w-4xl px-4 pb-8 pt-14 text-center sm:px-6 sm:pt-20">
          <motion.div variants={stagger(0.08, 0.05)} initial="hidden" animate="show">
            <motion.p variants={rise} className="text-[12px] font-semibold uppercase tracking-[0.16em] text-navy-700">
              AlphaCV
            </motion.p>
            <motion.h1
              variants={rise}
              className="mt-3 text-[40px] font-semibold leading-[1.05] tracking-[-0.04em] text-slate-900 sm:text-[56px]"
            >
              Hire with clarity.
            </motion.h1>
            <motion.p variants={rise} className="mx-auto mt-4 max-w-md text-[17px] leading-relaxed text-slate-500 sm:text-[19px]">
              AI screening from talent pool to ranked shortlist.
            </motion.p>
            <motion.div variants={rise} className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className="inline-flex h-11 items-center rounded-full bg-navy-900 px-6 text-[14px] font-semibold text-white hover:bg-navy-800"
              >
                Login
              </Link>
              <button
                type="button"
                onClick={scrollToDemo}
                className="inline-flex h-11 items-center rounded-full border border-slate-300 bg-white px-6 text-[14px] font-semibold text-navy-800 hover:border-navy-300 hover:bg-slate-50"
              >
                Watch the demo
              </button>
            </motion.div>
          </motion.div>
        </div>
        <div className="relative mx-auto max-w-6xl px-3 sm:px-6">
          <HeroDashboardPreview />
        </div>
      </section>

      <section id="product" className="bg-[#f5f5f7] px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-navy-700">Product</p>
          <h2 className="mt-2 text-center text-[32px] font-semibold tracking-[-0.03em] text-slate-900 sm:text-[40px]">
            Built for recruiters.
          </h2>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.id} className="flex flex-col overflow-hidden rounded-3xl bg-white shadow-sm">
                <div className="px-6 pb-2 pt-8 text-center">
                  <p className="text-[12px] font-semibold text-navy-700">{f.eyebrow}</p>
                  <h3 className="mt-1 text-[24px] font-semibold tracking-[-0.025em] text-slate-900">{f.title}</h3>
                  <p className="mt-2 text-[14px] text-slate-500">{f.sub}</p>
                </div>
                <div className="mt-auto px-4 pb-4 pt-6">
                  <img src={f.img} alt={f.imgAlt} className="h-48 w-full rounded-2xl object-cover sm:h-56" />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-navy-700">About AlphaCV</p>
            <h2 className="mt-3 text-[32px] font-semibold tracking-[-0.03em] text-slate-900 sm:text-[40px]">
              Alpha Data Recruitment.
            </h2>
            <p className="mt-4 max-w-md text-[16px] leading-relaxed text-slate-500">
              Purpose-built for hiring teams in the UAE. Match CVs to roles, run careers openings, and move from apply to shortlist in one workspace.
            </p>
            <Link
              href="/login"
              className="mt-8 inline-flex h-11 items-center rounded-full bg-navy-900 px-6 text-[14px] font-semibold text-white hover:bg-navy-800"
            >
              Sign in to AlphaCV
            </Link>
          </div>
          <img
            src="/marketing/alphacv-about.jpg"
            alt="Happy recruitment team"
            className="h-64 w-full rounded-3xl object-cover shadow-md sm:h-80 lg:h-[420px]"
          />
        </div>
      </section>

      <section id="demo" ref={demoSectionRef} className="bg-[#f5f5f7] px-3 py-8 sm:px-5 sm:py-12 lg:px-8">
        <div className="mx-auto max-w-[1400px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_-28px_rgba(15,23,42,0.4)]">
            <div className="relative h-[min(92dvh,1080px)] w-full overflow-hidden">
              {demoReady ? (
                <>
                  <ProductTour key={tourKey} embedded />
                  <button
                    type="button"
                    onClick={watchFromStart}
                    className="pointer-events-auto absolute left-1/2 top-4 z-[70] inline-flex h-10 -translate-x-1/2 items-center rounded-full bg-blue-600 px-5 text-[13px] font-semibold text-white shadow-md hover:bg-blue-700"
                  >
                    Watch from start
                  </button>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-4 bg-white px-6 text-center">
                  <button
                    type="button"
                    onClick={watchFromStart}
                    className="inline-flex h-11 items-center rounded-full bg-blue-600 px-6 text-[14px] font-semibold text-white hover:bg-blue-700"
                  >
                    Watch from start
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-20 text-center sm:px-6 sm:py-28">
        <h2 className="text-[32px] font-semibold tracking-[-0.03em] text-slate-900 sm:text-[44px]">
          Ready when you are.
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-[16px] text-slate-500">Sign in to your AlphaCV workspace.</p>
        <Link
          href="/login"
          className="mt-8 inline-flex h-12 items-center rounded-full bg-navy-900 px-8 text-[15px] font-semibold text-white hover:bg-navy-800"
        >
          Login
        </Link>
      </section>

      <footer className="border-t border-slate-200 bg-[#f5f5f7] px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-[12px] text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <img src="/alphadatalogo.svg" alt="" className="h-5 w-5 object-contain opacity-80" />
            <span>Copyright © {new Date().getFullYear()} Alpha Data Recruitment</span>
          </div>
          <div className="flex gap-5">
            <Link href="/login" className="hover:text-slate-800">Login</Link>
            <Link href="/careers/openings" className="hover:text-slate-800">Careers</Link>
            <a href="#demo" onClick={scrollToDemo} className="hover:text-slate-800">Demo</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
