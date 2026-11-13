"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { rise } from "@/lib/motion";

/**
 * Page-level layout primitives: the header every page starts with, and the empty state every list falls back to.
 */

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Page title, set in the display face */
  title: React.ReactNode;
  /** Optional one-line description under the title */
  description?: React.ReactNode;
  /** Right-side actions slot (buttons, filters, ...) */
  actions?: React.ReactNode;
  /** Small label above the title */
  eyebrow?: React.ReactNode;
  /** Feature image mark shown beside the title (e.g. /icons/candidates.jpg) */
  markSrc?: string;
  /** Chips or counters shown beside the title */
  meta?: React.ReactNode;
}

export function PageHeader({ title, description, actions, eyebrow, markSrc, meta, className, ...props }: PageHeaderProps) {
  return (
    <motion.div
      variants={rise}
      initial="hidden"
      animate="show"
      className={cn("mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between", className)}
      {...(props as object)}
    >
      <div className="flex min-w-0 items-start gap-3">
        {markSrc ? (
          <img src={markSrc} alt="" draggable={false} className="mt-0.5 h-9 w-9 shrink-0 rounded-xl object-cover shadow-raised ring-1 ring-black/5 sm:h-10 sm:w-10" />
        ) : null}
        <div className="min-w-0">
          {eyebrow ? <div className="mb-1 text-2xs font-semibold uppercase tracking-[0.1em] text-navy-600">{eyebrow}</div> : null}
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-xl font-semibold leading-tight tracking-[-0.03em] text-slate-900 sm:text-2xl sm:text-[26px]">{title}</h1>
            {meta}
          </div>
          {description ? <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">{actions}</div> : null}
    </motion.div>
  );
}

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Icon component, rendered inside a soft tile */
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  /** Secondary hint text */
  hint?: React.ReactNode;
  /** Optional action (e.g. a primary button) */
  action?: React.ReactNode;
  /** A tighter version for inside panels */
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, hint, action, compact, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-paper text-center",
        compact ? "px-5 py-9" : "px-6 py-14",
        className
      )}
      {...props}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(60%_80%_at_50%_0%,rgb(var(--navy-100)/0.6),transparent)]" />
      {Icon ? (
        <div className={cn("relative mb-4 flex items-center justify-center rounded-2xl bg-paper text-navy-700 shadow-raised ring-1 ring-slate-200", compact ? "h-11 w-11" : "h-14 w-14")}>
          <Icon className={compact ? "h-5 w-5" : "h-6 w-6"} />
        </div>
      ) : null}
      <div className="relative text-md font-semibold tracking-[-0.015em] text-slate-900">{title}</div>
      {hint ? <div className="relative mt-1.5 max-w-sm text-sm text-slate-500">{hint}</div> : null}
      {action ? <div className="relative mt-4">{action}</div> : null}
    </div>
  );
}

/** A titled section card, the one container most page sections use. */
export function Section({ title, subtitle, action, children, className, bodyClassName, dense }: {
  title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; dense?: boolean;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-paper shadow-card', className)}>
      <header className={cn('flex items-start justify-between gap-3 px-5 pt-5', dense ? 'pb-2' : 'pb-3')}>
        <div className="min-w-0">
          <h2 className="text-md font-semibold tracking-[-0.015em] text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      <div className={cn('flex-1 px-5 pb-5', bodyClassName)}>{children}</div>
    </section>
  );
}
