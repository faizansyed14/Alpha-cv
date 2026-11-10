"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { rise } from "@/lib/motion";

/**
 * Page-level layout primitives.
 */

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Page title, set in the serif display face: the one decorative element on a page */
  title: React.ReactNode;
  /** Optional one-line description under the title */
  description?: React.ReactNode;
  /** Right-side actions slot (buttons, filters, ...) */
  actions?: React.ReactNode;
  /** Small label above the title */
  eyebrow?: React.ReactNode;
  /** Real feature image mark shown beside the title (e.g. /icons/candidates.jpg) */
  markSrc?: string;
}

export function PageHeader({ title, description, actions, eyebrow, markSrc, className, ...props }: PageHeaderProps) {
  return (
    <motion.div
      variants={rise}
      initial="hidden"
      animate="show"
      className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}
      {...(props as object)}
    >
      <div className="flex min-w-0 items-start gap-3">
        {markSrc ? (
          <img src={markSrc} alt="" draggable={false} className="mt-0.5 h-10 w-10 shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-black/5" />
        ) : null}
        <div className="min-w-0">
          {eyebrow ? <div className="mb-1 text-xs font-semibold text-navy-600">{eyebrow}</div> : null}
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.025em] text-slate-900 sm:text-2xl">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
    </motion.div>
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
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-strong bg-paper px-6 py-14 text-center",
        className
      )}
      {...props}
    >
      {Icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-50 ring-1 ring-inset ring-navy-100">
          <Icon className="h-5 w-5 text-blue-600" />
        </div>
      ) : null}
      <div className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">{title}</div>
      {hint ? <div className="mt-1.5 max-w-sm text-sm text-slate-500">{hint}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
