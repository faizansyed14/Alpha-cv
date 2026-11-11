'use client';

import type { ComponentType } from 'react';
import { motion } from 'framer-motion';
import { roleLabel } from '@/lib/roles';
import { Briefcase, Cpu, Megaphone, MessageSquare, Target, Users } from '@/components/icons';
import { ease } from '@/lib/motion';
import type { AgenticCapabilities } from '@/lib/types';

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  jobs: Briefcase, matching: Target, candidates: Users, interview: MessageSquare, linkedin: Megaphone, admin: Cpu,
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const ROLE_LINE: Record<string, string> = {
  admin: 'You can do everything here, plus see how the AI tokens are being used.',
  manager: 'Post jobs, find and review candidates, run matching and write interview questions and posts.',
  evp: 'Post jobs, find and review candidates, run matching and write interview questions and posts.',
  user: 'Post jobs, find and review candidates, run matching and write interview questions and posts.',
  account_manager: 'Post jobs, find and review candidates, run matching and write interview questions and posts.',
};

/** The first screen: who you are signed in as, what your role can ask for, and one click to start. */
export function Welcome({ caps, onSend, disabled }: { caps: AgenticCapabilities | null; onSend: (text: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-6 pt-8 sm:px-6 sm:pt-14">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }} className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/video/ai-robot.gif"
          alt=""
          aria-hidden
          className="mx-auto mb-4 h-28 w-28 object-contain sm:mb-5 sm:h-32 sm:w-32"
        />
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[38px]">
          {greeting()}{caps ? `, ${caps.username}` : ''}
        </h1>
        <p className="mx-auto mt-2.5 max-w-xl text-[15px] leading-relaxed text-slate-600">
          What would you like to get done? Just ask, and I will use the application for you.
        </p>
        {caps && (
          <p className="mx-auto mt-3 inline-flex rounded-full bg-white/70 px-3.5 py-1 text-[12px] font-medium text-slate-600 ring-1 ring-inset ring-white/80 backdrop-blur">
            Signed in as {roleLabel(caps.role)}. {ROLE_LINE[caps.role] ?? ''}
          </p>
        )}
      </motion.div>

      <div className="mt-9 grid gap-3 sm:grid-cols-2">
        {(caps?.skills ?? []).map((s, i) => {
          const Icon = ICONS[s.name] ?? Briefcase;
          return (
            <motion.div
              key={s.name} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease, delay: 0.08 + i * 0.06 }}
              className="rounded-2xl border border-white/80 bg-white/75 p-4 shadow-[0_10px_30px_-20px_rgba(30,50,96,0.45)] backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-900 text-white"><Icon className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-slate-900">{s.label}</p>
                  <p className="text-[12.5px] leading-snug text-slate-500">{s.description}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.examples.slice(0, 2).map((ex) => (
                  <button key={ex} type="button" disabled={disabled} onClick={() => onSend(ex)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-left text-[12px] text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50">
                    {ex}
                  </button>
                ))}
              </div>
            </motion.div>
          );
        })}
        {!caps && [0, 1, 2, 3].map((k) => <div key={k} className="h-[120px] animate-pulse rounded-2xl bg-white/60" />)}
      </div>
      <p className="mt-6 text-center text-[12px] text-slate-500">
        I can read, create, match and write. I never delete anything, and I ask you to confirm before I post a job or change anything.
      </p>
    </div>
  );
}
