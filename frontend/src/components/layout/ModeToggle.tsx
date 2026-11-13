'use client';

import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { spring } from '@/lib/motion';

const BACK_KEY = 'alpha_cv_classic_path';

/**
 * The switch at the top right that turns the whole application into Agentic mode and back.
 * On: the Agentic page (one full-page assistant). Off: the page you came from.
 */
export function ModeToggle({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname() || '';
  const on = pathname.replace(/\/$/, '') === '/agentic';

  const toggle = () => {
    if (!on) {
      try { sessionStorage.setItem(BACK_KEY, pathname || '/dashboard'); } catch { /* the toggle still works without it */ }
      router.push('/agentic');
      return;
    }
    let back = '/dashboard';
    try { back = sessionStorage.getItem(BACK_KEY) || back; } catch { /* default */ }
    router.push(back.startsWith('/agentic') ? '/dashboard' : back);
  };

  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={toggle}
      title={on ? 'Switch back to the classic screens' : 'Switch to Agentic mode'}
      className={cn(
        'group inline-flex items-center gap-2 rounded-full border py-1 pl-2 pr-1.5 text-xs font-semibold transition-colors',
        on ? 'border-navy-200 bg-navy-50 text-navy-900' : 'border-slate-200 bg-paper text-slate-600 hover:border-slate-300 hover:text-slate-900',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/video/ai-robot.gif" alt="" aria-hidden className="h-5 w-5 shrink-0 object-contain" />
      <span>Agentic mode</span>
      <span className={cn('relative h-5 w-9 rounded-full transition-colors', on ? 'bg-solid-hover' : 'bg-slate-300 group-hover:bg-slate-400')}>
        <motion.span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-paper shadow"
          animate={{ left: on ? 18 : 2 }} transition={spring.snappy}
        />
      </span>
    </button>
  );
}
