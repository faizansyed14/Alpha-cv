'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, Menu, X } from '@/components/icons';
import { rise, stagger } from '@/lib/motion';

const ProductTour = dynamic(() => import('@/components/demo/ProductTour'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[320px] items-center justify-center bg-paper text-sm text-slate-500">
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
  const [fullscreen, setFullscreen] = useState(false);
  const [fsTourKey, setFsTourKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
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
      { root: null, rootMargin: '0px', threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);

  const scrollToTop = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const scrollToDemo = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(false);
    demoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setDemoReady(true);
  }, []);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const watchFromStart = useCallback(() => {
    setDemoReady(true);
    setTourKey((k) => k + 1);
    demoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const openFullscreen = useCallback(() => {
    setDemoReady(true);
    setFsTourKey((k) => k + 1);
    setFullscreen(true);
  }, []);

  return (
    <div id="top" className="min-h-dvh bg-paper text-slate-900" style={{ fontFamily: 'var(--font-sans)' }}>
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-paper/80 backdrop-blur-xl">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="#top" onClick={scrollToTop} className="flex items-center gap-2.5" aria-label="AlphaCV home">
            <img src="/alphadatalogo.svg" alt="" className="h-7 w-7 object-contain" />
            <span className="text-md font-semibold tracking-[-0.02em]">
              Alpha<span className="text-navy-700">CV</span>
            </span>
          </a>
          <nav className="hidden items-center gap-7 text-xs font-medium text-slate-600 sm:flex">
            <a href="#product" className="hover:text-slate-900">Product</a>
            <a href="#about" className="hover:text-slate-900">About</a>
            <a href="#demo" onClick={scrollToDemo} className="hover:text-slate-900">Demo</a>
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 sm:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <Link
              href="/login"
              className="inline-flex h-8 items-center rounded-full bg-solid px-4 text-xs font-semibold text-white hover:bg-solid-hover"
            >
              Login
            </Link>
          </div>
        </div>
        {menuOpen ? (
          <nav className="border-t border-slate-200/70 bg-paper px-4 py-3 sm:hidden">
            <div className="mx-auto flex max-w-6xl flex-col gap-1 text-sm font-medium text-slate-700">
              <a href="#product" onClick={closeMenu} className="rounded-lg px-3 py-2.5 hover:bg-slate-100 hover:text-slate-900">
                Product
              </a>
              <a href="#about" onClick={closeMenu} className="rounded-lg px-3 py-2.5 hover:bg-slate-100 hover:text-slate-900">
                About
              </a>
              <a href="#demo" onClick={scrollToDemo} className="rounded-lg px-3 py-2.5 hover:bg-slate-100 hover:text-slate-900">
                Demo
              </a>
            </div>
          </nav>
        ) : null}
      </header>

      <section className="relative flex min-h-[calc(100dvh-3rem)] items-center justify-center overflow-hidden bg-paper px-4 py-16 sm:px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_480px_at_50%_20%,rgba(22,32,75,0.07),transparent_60%)]"
        />
        <div className="relative mx-auto w-full max-w-4xl text-center">
          <motion.div variants={stagger(0.08, 0.05)} initial="hidden" animate="show">
            <motion.p
              variants={rise}
              className="text-[15px] font-semibold uppercase tracking-[0.2em] text-navy-700 sm:text-[17px]"
            >
              AlphaCV
            </motion.p>
            <motion.h1
              variants={rise}
              className="mt-5 text-[40px] font-semibold leading-[1.02] tracking-[-0.045em] text-slate-900 min-[400px]:text-[48px] sm:text-[72px] lg:text-[84px]"
            >
              Hire with clarity.
            </motion.h1>
            <motion.p
              variants={rise}
              className="mx-auto mt-6 max-w-xl text-[18px] leading-relaxed text-slate-500 sm:text-[22px]"
            >
              AI screening from talent pool to ranked shortlist.
            </motion.p>
            <motion.div variants={rise} className="mt-10 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              <Link
                href="/login"
                className="inline-flex h-12 items-center rounded-full bg-solid px-8 text-[16px] font-semibold text-white hover:bg-solid-hover sm:h-14 sm:px-10 sm:text-[17px]"
              >
                Login
              </Link>
              <button
                type="button"
                onClick={scrollToDemo}
                className="inline-flex h-12 items-center rounded-full border border-slate-300 bg-paper px-8 text-[16px] font-semibold text-navy-800 hover:border-navy-300 hover:bg-slate-50 sm:h-14 sm:px-10 sm:text-[17px]"
              >
                Watch the demo
              </button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section id="product" className="bg-[#f5f5f7] px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-navy-700">Product</p>
          <h2 className="mt-2 text-center text-[32px] font-semibold tracking-[-0.03em] text-slate-900 sm:text-[40px]">
            Built for recruiters.
          </h2>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.id} className="flex flex-col overflow-hidden rounded-3xl bg-paper shadow-sm">
                <div className="px-6 pb-2 pt-8 text-center">
                  <p className="text-xs font-semibold text-navy-700">{f.eyebrow}</p>
                  <h3 className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-slate-900">{f.title}</h3>
                  <p className="mt-2 text-base text-slate-500">{f.sub}</p>
                </div>
                <div className="mt-auto px-4 pb-4 pt-6">
                  <img src={f.img} alt={f.imgAlt} className="h-48 w-full rounded-2xl object-cover sm:h-56" />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="bg-paper">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-navy-700">About AlphaCV</p>
            <h2 className="mt-3 text-[32px] font-semibold tracking-[-0.03em] text-slate-900 sm:text-[40px]">
              Alpha Data Recruitment.
            </h2>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-slate-500">
              Purpose-built for hiring teams in the UAE. Match CVs to roles, run careers openings, and move from apply to shortlist in one workspace.
            </p>
            <Link
              href="/login"
              className="mt-8 inline-flex h-11 items-center rounded-full bg-solid px-6 text-base font-semibold text-white hover:bg-solid-hover"
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

      <section id="demo" ref={demoSectionRef} className="bg-[#f5f5f7] px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-navy-700">Demo</p>
          <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-slate-900 sm:text-[34px]">
            See AlphaCV in action.
          </h2>
        </div>
        <div className="relative mx-auto mt-8 max-w-[920px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-paper shadow-[0_20px_60px_-28px_rgba(15,23,42,0.35)]">
            <div className="relative aspect-[16/10] w-full overflow-hidden sm:aspect-[16/9]">
              {demoReady ? (
                <>
                  <ProductTour key={tourKey} embedded />
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-[70] flex items-start justify-between gap-2 p-3">
                    <button
                      type="button"
                      onClick={watchFromStart}
                      className="pointer-events-auto inline-flex h-9 items-center rounded-full bg-solid px-4 text-[13px] font-semibold text-white shadow-md hover:bg-solid-hover"
                    >
                      Watch from start
                    </button>
                    <button
                      type="button"
                      onClick={openFullscreen}
                      className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-paper/95 px-3.5 text-[13px] font-semibold text-slate-800 shadow-md backdrop-blur hover:bg-paper"
                      aria-label="Open demo full screen"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Full screen
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 bg-paper px-6 text-center">
                  <button
                    type="button"
                    onClick={watchFromStart}
                    className="inline-flex h-11 items-center rounded-full bg-solid px-6 text-base font-semibold text-white hover:bg-solid-hover"
                  >
                    Watch from start
                  </button>
                  <button
                    type="button"
                    onClick={openFullscreen}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-slate-300 bg-paper px-5 text-[13px] font-semibold text-navy-800 hover:border-navy-300"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Full screen
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <AnimatePresence>
        {fullscreen ? (
          <motion.div
            key="demo-fs"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-2 backdrop-blur-[1px] sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setFullscreen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="AlphaCV product demo full screen"
          >
            <motion.div
              className="relative h-full w-full max-h-[100dvh] max-w-[1600px] overflow-hidden rounded-2xl border border-white/20 bg-paper shadow-2xl"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
            >
              <ProductTour key={`fs-${fsTourKey}`} embedded />
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                className="absolute right-4 top-4 z-[110] inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-paper/95 text-slate-700 shadow-md backdrop-blur hover:bg-paper"
                aria-label="Close full screen demo"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setFsTourKey((k) => k + 1)}
                className="absolute left-4 top-4 z-[110] inline-flex h-10 items-center rounded-full bg-solid px-4 text-[13px] font-semibold text-white shadow-md hover:bg-solid-hover"
              >
                Watch from start
              </button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <section className="bg-paper px-4 py-20 text-center sm:px-6 sm:py-28">
        <h2 className="text-[32px] font-semibold tracking-[-0.03em] text-slate-900 sm:text-[44px]">
          Ready when you are.
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-lg text-slate-500">Sign in to your AlphaCV workspace.</p>
        <Link
          href="/login"
          className="mt-8 inline-flex h-12 items-center rounded-full bg-solid px-8 text-md font-semibold text-white hover:bg-solid-hover"
        >
          Login
        </Link>
      </section>

      <footer className="border-t border-slate-200 bg-[#f5f5f7] px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <img src="/alphadatalogo.svg" alt="" className="h-5 w-5 object-contain opacity-80" />
            <span>Copyright © {new Date().getFullYear()} Alpha Data Recruitment</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link href="/login" className="py-1 hover:text-slate-800">Login</Link>
            <Link href="/careers/openings" className="py-1 hover:text-slate-800">Careers</Link>
            <a href="#demo" onClick={scrollToDemo} className="py-1 hover:text-slate-800">Demo</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
