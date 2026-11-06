import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold leading-4 transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-surface-border bg-slate-100 text-slate-700",
        secondary: "border-surface-border bg-slate-50 text-slate-600",
        destructive: "border-red-200 bg-red-50 text-red-700",
        danger: "border-red-200 bg-red-50 text-red-700",
        outline: "border-surface-strong bg-paper text-slate-600",
        success: "border-emerald-200 bg-emerald-50 text-emerald-700",
        warning: "border-amber-200 bg-amber-50 text-amber-700",
        info: "border-blue-200 bg-blue-50 text-blue-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
