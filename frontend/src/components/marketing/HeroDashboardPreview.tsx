'use client';

import {
  Briefcase,
  Calendar,
  FileText,
  Globe2,
  LayoutDashboard,
  Plus,
  Sparkles,
  Target,
  Upload,
  Users,
} from '@/components/icons';
import { MonthBars, Sparkline, TrendChart } from '@/components/dashboard/charts';
import { TOUR_NAV, DEMO_APP_DAYS, DEMO_APP_SERIES, DEMO_MONTHS } from '@/components/demo/fakeData';
import { cn } from '@/lib/utils';

const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  candidates: Users,
  jobs: FileText,
  match: Target,
  upload: Upload,
  careers: Globe2,
};

/** Static marketing preview matching real AlphaCV dashboard chrome. */
export default function HeroDashboardPreview() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-[0_24px_80px_-24px_rgba(15,23,42,0.35)]"
      style={{ fontFamily: 'var(--font-sans)' }}
    >
      <div className="flex min-h-[420px] sm:min-h-[520px]">
        <aside className="hidden w-[220px] shrink-0 flex-col border-r border-surface-border bg-gradient-to-br from-navy-50 via-sky-50/60 to-white sm:flex">
          <div className="flex h-16 shrink-0 items-center px-4">
            <span className="truncate text-[17px] font-bold tracking-[-0.03em] text-slate-900">
              Alpha<span className="text-navy-600">CV</span>
            </span>
          </div>
          <nav className="space-y-5 px-3 pb-4 pt-1">
            {(['Recruiting', 'Hiring'] as const).map((section) => (
              <div key={section} className="space-y-0.5">
                <div className="mb-1 px-3 text-[11px] font-semibold text-slate-400">{section}</div>
                {TOUR_NAV.filter((t) => t.section === section).map((tab) => {
                  const active = tab.id === 'dashboard';
                  const Icon = NAV_ICONS[tab.id] ?? LayoutDashboard;
                  return (
                    <div
                      key={tab.id}
                      className={cn(
                        'flex h-11 w-full items-center gap-3 rounded-xl border px-3 text-[13.5px]',
                        active
                          ? 'border-navy-300 bg-navy-50/70 font-medium text-navy-700'
                          : 'border-transparent font-normal text-slate-600',
                      )}
                    >
                      <Icon className={cn('h-5 w-5', active ? 'text-navy-700' : 'text-slate-500')} />
                      <span className="truncate">{tab.label}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-4 overflow-hidden bg-white p-4 sm:p-5">
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-navy-950 via-navy-800 to-navy-600 px-6 py-6 text-white shadow-lg sm:px-8 sm:py-8">
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-sky-300/10 blur-3xl" />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.07]"
              style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '22px 22px' }}
            />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.14em] text-white/60">
                  <Calendar className="h-3.5 w-3.5" /> Monday, 9 November
                </p>
                <h2 className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.03em] sm:text-[32px]">
                  Good morning, John
                </h2>
                <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/75">
                  12 live jobs · 48 new applications in the last 7 days
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-[13px] font-semibold text-navy-900 shadow-sm">
                  <Plus className="h-4 w-4" /> Post a job
                </span>
                <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-[13px] font-semibold text-white backdrop-blur">
                  <Upload className="h-4 w-4" /> Upload CVs
                </span>
                <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-[13px] font-semibold text-white backdrop-blur">
                  <Target className="h-4 w-4" /> New match
                </span>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              { label: 'Candidates', value: '1,284', hint: 'In the talent pool', icon: Users },
              { label: 'Job descriptions', value: '46', hint: 'Roles ready to match', icon: Briefcase },
              { label: 'Live jobs', value: '12', hint: '18 posted · 6 closed', icon: Sparkles },
              { label: 'Applications', value: '326', hint: '48 in the last 7 days', spark: true },
            ].map((k) => (
              <div
                key={k.label}
                className="flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-surface-border bg-white p-4 shadow-card sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-50 text-navy-800 ring-1 ring-inset ring-navy-100">
                    {k.spark ? <Target className="h-5 w-5" /> : k.icon ? <k.icon className="h-5 w-5" /> : null}
                  </span>
                  {k.spark ? <Sparkline values={DEMO_APP_SERIES} /> : null}
                </div>
                <div className="mt-4">
                  <p className="text-[12.5px] font-medium text-slate-500">{k.label}</p>
                  <p className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-slate-900 sm:text-[32px]">
                    {k.value}
                  </p>
                  <p className="mt-2 text-[12px] text-slate-500">{k.hint}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-surface-border bg-white p-5 shadow-card lg:col-span-2">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Applications received</h3>
                  <p className="mt-0.5 text-[12.5px] text-slate-500">Per day, last 14 days</p>
                </div>
                <div className="text-right">
                  <p className="text-[22px] font-semibold leading-none tabular-nums text-slate-900">
                    {DEMO_APP_SERIES.reduce((a, b) => a + b, 0)}
                  </p>
                  <p className="mt-1 text-[11.5px] text-slate-500">in 14 days</p>
                </div>
              </div>
              <TrendChart values={DEMO_APP_SERIES} days={DEMO_APP_DAYS} />
            </div>
            <div className="rounded-2xl border border-surface-border bg-white p-5 shadow-card">
              <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Jobs posted</h3>
              <p className="mt-0.5 mb-3 text-[12.5px] text-slate-500">Per month, last 6 months</p>
              <MonthBars months={DEMO_MONTHS} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
