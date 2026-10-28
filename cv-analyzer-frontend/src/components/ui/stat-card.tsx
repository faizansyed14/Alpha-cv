import * as React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 11px uppercase label, e.g. "TOTAL CVS" */
  label: React.ReactNode;
  /** Big value, e.g. 1248 or "86%" */
  value: React.ReactNode;
  /** Lucide icon component, rendered at 16px in a soft brand square */
  icon?: React.ComponentType<{ className?: string }>;
  /** Optional trend, e.g. { value: "+12%", direction: "up" } */
  trend?: {
    value: React.ReactNode;
    direction: "up" | "down";
  };
  /** Extra hint below the value, e.g. "vs last week" */
  hint?: React.ReactNode;
}

/** Small KPI card for dashboards / page headers. */
export function StatCard({ label, value, icon: Icon, trend, hint, className, ...props }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-surface-border bg-paper p-4 shadow-[var(--shadow-sm)]",
        className
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {label}
          </div>
          <div className="mt-1.5 text-xl font-semibold leading-7 text-navy-500 tabular-nums">{value}</div>
        </div>
        {Icon ? (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-navy-50">
            <Icon className="h-4 w-4 text-navy-500" />
          </div>
        ) : null}
      </div>
      {(trend || hint) && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px]">
          {trend ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-medium",
                trend.direction === "up" ? "text-green-600" : "text-red-600"
              )}
            >
              {trend.direction === "up" ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              {trend.value}
            </span>
          ) : null}
          {hint ? <span className="text-ink-muted">{hint}</span> : null}
        </div>
      )}
    </div>
  );
}

export default StatCard;
