import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Page-level layout primitives for the ERP design system.
 */

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Page title — rendered at 18px semibold */
  title: React.ReactNode;
  /** Optional one-line description under the title */
  description?: React.ReactNode;
  /** Right-side actions slot (buttons, filters, ...) */
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions, className, ...props }: PageHeaderProps) {
  return (
    <div
      className={cn("mb-5 flex flex-wrap items-start justify-between gap-3", className)}
      {...props}
    >
      <div className="min-w-0">
        <h1 className="text-lg font-semibold leading-7 tracking-tight text-slate-900">{title}</h1>
        {description ? (
          <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Lucide icon component, rendered at 20px inside a soft circle */
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  /** Secondary hint text */
  hint?: React.ReactNode;
  /** Optional action (e.g. a primary button) */
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, hint, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      {Icon ? (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
          <Icon className="h-5 w-5 text-slate-400" />
        </div>
      ) : null}
      <div className="text-sm font-medium text-slate-900">{title}</div>
      {hint ? <div className="mt-1 max-w-sm text-[13px] text-slate-500">{hint}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
