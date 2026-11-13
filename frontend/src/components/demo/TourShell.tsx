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
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-paper">
      {!hideSidebar && (
        <aside className="relative hidden w-[220px] shrink-0 flex-col overflow-hidden border-r border-surface-border bg-paper/80 backdrop-blur-xl lg:flex">
          <div className="relative flex h-14 shrink-0 items-center px-3">
            <span className="truncate text-md font-semibold tracking-[-0.03em] text-slate-900">
              Alpha<span className="text-navy-600">CV</span>
            </span>
          </div>
          <nav className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-2.5 pb-3 pt-1" aria-label="Tour navigation">
            {sections.map((section) => (
              <div key={section} className="space-y-0.5">
                <div className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{section}</div>
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
                        'relative flex h-9 w-full items-center gap-2.5 rounded-lg border px-2.5 text-sm transition-colors duration-300',
                        tourTargetClass,
                        active
                          ? 'border-navy-200 bg-navy-50 font-semibold text-navy-800'
                          : 'border-transparent font-medium text-slate-600',
                      )}
                    >
                      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                        <Icon className={cn('h-4 w-4', active ? 'text-navy-700' : 'text-slate-500')} />
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
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-paper">
        {/* overflow hidden: tour is video-like; only scripted scrolls move content */}
        <div className="min-h-0 flex-1 overflow-hidden px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
