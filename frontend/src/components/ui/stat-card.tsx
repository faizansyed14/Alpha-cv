import * as React from "react";
import { TrendingDown, TrendingUp } from "@/components/icons";
import { cn } from "@/lib/utils";
import { TONE, type Tone } from "@/lib/tones";
import { Bone } from "@/components/skeletons/blocks";

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Small label, e.g. "Candidates" */
  label: React.ReactNode;
  /** Big value, e.g. 1248 or "86%" */
  value: React.ReactNode;
  /** Icon component, rendered at 18px in a tinted tile */
  icon?: React.ComponentType<{ className?: string }>;
  /** Optional trend, e.g. { value: "+12%", direction: "up" } */
  trend?: { value: React.ReactNode; direction: "up" | "down" | "flat" };
  /** Extra hint below the value, e.g. "vs last week" */
  hint?: React.ReactNode;
  /** Colour of the icon tile */
  tone?: Tone;
  /** A short series drawn as a sparkline beside the value */
  spark?: number[];
  /** Makes the card a button */
  onClick?: () => void;
  /** The number is still loading: the label and icon stay, only the number is a placeholder */
  loading?: boolean;
  /** Dense KPI for tool pages (tracker): smaller padding and type, hint as title only */
  compact?: boolean;
}

function Spark({ values, className }: { values: number[]; className?: string }) {
  const w = 84, h = 28;
  if (values.length < 2) return null;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - min) / span) * (h - 4)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;
  const id = React.useId();
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className={cn("overflow-visible", className)}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.25" fill="currentColor" />
    </svg>
  );
}

/** KPI card for dashboards and page headers: label, a display-face number, an optional trend chip, hint and sparkline. */
export function StatCard({ label, value, icon: Icon, trend, hint, tone = "blue", spark, className, onClick, loading, compact, ...props }: StatCardProps) {
  const Tag: any = onClick ? "button" : "div";
  const hintText = typeof hint === "string" ? hint : undefined;
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={compact ? hintText : undefined}
      className={cn(
        "group relative min-w-0 overflow-hidden border border-surface-border bg-paper text-left shadow-card",
        compact ? "rounded-xl" : "rounded-2xl",
        onClick && "card-interactive",
        className
      )}
      {...props}
    >
      <div className={cn(compact ? "px-2 pb-1.5 pt-1.5" : "px-5 pb-4 pt-4")}>
        <div className="flex items-center justify-between gap-1">
          <div className={cn("truncate font-medium text-slate-500", compact ? "text-2xs" : "text-xs")}>{label}</div>
          {Icon ? (
            <div className={cn(
              "flex shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
              compact ? "h-5 w-5" : "h-9 w-9 rounded-xl",
              TONE[tone].tile,
            )}>
              <Icon className={compact ? "h-2.5 w-2.5" : "h-[18px] w-[18px]"} />
            </div>
          ) : null}
        </div>
        <div className={cn("flex items-end justify-between gap-2", compact ? "mt-0.5" : "mt-2 gap-3")}>
          {loading ? (
            <span role="status" aria-label={`Loading ${typeof label === "string" ? label : "value"}`}>
              <Bone className={cn("rounded-lg", compact ? "h-4 w-8" : "h-[30px] w-16")} />
            </span>
          ) : (
            <div className={cn("stat-number leading-none", compact ? "text-base" : "text-[30px]")}>{value}</div>
          )}
          {spark && !loading && !compact ? <span className={cn("shrink-0 pb-0.5", TONE[tone].text)}><Spark values={spark} /></span> : null}
        </div>
      </div>
      {!compact && ((trend && !loading) || hint) && (
        <div className="flex items-center gap-2 border-t border-surface-border/80 px-5 py-2.5 text-xs">
          {trend && !loading ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold",
                trend.direction === "up" ? "bg-emerald-50 text-emerald-700" : trend.direction === "down" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"
              )}
            >
              {trend.direction === "up" ? <TrendingUp className="h-3 w-3" /> : trend.direction === "down" ? <TrendingDown className="h-3 w-3" /> : null}
              {trend.value}
            </span>
          ) : null}
          {hint ? <span className="truncate text-slate-500">{hint}</span> : null}
        </div>
      )}
    </Tag>
  );
}

export default StatCard;
