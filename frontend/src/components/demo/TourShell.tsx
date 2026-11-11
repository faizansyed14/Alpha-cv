'use client';

import { cn } from '@/lib/utils';
import {
  FileText,
  Globe2,
  LayoutDashboard,
  Target,
  Upload,
  Users,
} from '@/components/icons';
import { TOUR_NAV } from './fakeData';
import { tourTargetClass } from './TourCursor';

const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  candidates: Users,
  jobs: FileText,
  match: Target,
  upload: Upload,
  careers: Globe2,
};

/** Same sidebar chrome as AppShell. Main area is white for the product tour. */
export default function TourShell({
  activeId,
  children,
  hideSidebar = false,
}: {
  activeId: string;
  children: React.ReactNode;
  hideSidebar?: boolean;
}) {
  const sections = ['Recruiting', 'Hiring'] as const;

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-white">
      {!hideSidebar && (
        <aside className="relative hidden w-[240px] shrink-0 flex-col overflow-hidden border-r border-surface-border bg-white lg:flex">
          <div className="relative flex h-16 shrink-0 items-center px-4">
            <span className="truncate text-[17px] font-bold tracking-[-0.03em] text-slate-900">
              Alpha<span className="text-navy-600">CV</span>
            </span>
          </div>
          <nav className="relative min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-1" aria-label="Tour navigation">
            {sections.map((section) => (
              <div key={section} className="space-y-0.5">
                <div className="mb-1 px-3 text-[11px] font-semibold text-slate-400">{section}</div>
                {TOUR_NAV.filter((t) => t.section === section).map((tab) => {
                  const active = activeId === tab.id;
                  const Icon = NAV_ICONS[tab.id] ?? LayoutDashboard;
                  return (
                    <div
                      key={tab.id}
                      data-tour={`nav-${tab.id}`}
                      data-tour-label={tab.label}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex h-11 w-full items-center gap-3 rounded-xl border px-3 text-[13.5px] transition-colors duration-300',
                        tourTargetClass,
                        active
                          ? 'border-navy-300 bg-navy-50/70 font-medium text-navy-700'
                          : 'border-transparent font-normal text-slate-600',
                      )}
                    >
                      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                        <Icon className={cn('h-5 w-5', active ? 'text-navy-700' : 'text-slate-500')} />
                      </span>
                      <span className="relative min-w-0 flex-1 truncate text-left">{tab.label}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>
      )}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {/* overflow hidden: tour is video-like; only scripted scrolls move content */}
        <div className="min-h-0 flex-1 overflow-hidden px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
