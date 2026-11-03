import * as React from "react";
import { TrendingDown, TrendingUp } from "@/components/icons";
import { cn } from "@/lib/utils";
import { TONE, type Tone } from "@/lib/tones";

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
  /** Colour of the icon tile (default blue). */
  tone?: Tone;
}

/** Small KPI card for dashboards / page headers. */
export function StatCard({ label, value, icon: Icon, trend, hint, tone = 'blue', className, ...props }: StatCardProps) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border border-surface-border bg-paper shadow-card",
        className
      )}
      {...props}
    >
      <div className="px-5 pb-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-medium text-slate-500">{label}</div>
          {Icon ? (
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", TONE[tone].tile)}>
              <Icon className="h-[18px] w-[18px]" />
            </div>
          ) : null}
        </div>
        <div className="mt-3 text-[32px] font-semibold leading-none tracking-[-0.03em] text-slate-900 tabular-nums">{value}</div>
      </div>
      {(trend || hint) && (
        <div className="flex items-center gap-2 border-t border-surface-border px-5 py-2.5 text-xs">
          {trend ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-medium",
                trend.direction === "up" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
              )}
            >
              {trend.direction === "up" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {trend.value}
            </span>
          ) : null}
          {hint ? <span className="text-slate-500">{hint}</span> : null}
        </div>
      )}
    </div>
  );
}

export default StatCard;
