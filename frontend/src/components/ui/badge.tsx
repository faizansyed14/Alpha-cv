import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** A small status label. `dot` adds a coloured point before the text (status rows, filters). */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold leading-4 transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-slate-200 bg-slate-100 text-slate-700",
        secondary: "border-slate-200 bg-slate-50 text-slate-600",
        destructive: "border-red-200 bg-red-50 text-red-700",
        danger: "border-red-200 bg-red-50 text-red-700",
        outline: "border-slate-300 bg-paper text-slate-600",
        success: "border-emerald-200 bg-emerald-50 text-emerald-700",
        warning: "border-amber-200 bg-amber-50 text-amber-700",
        info: "border-navy-200 bg-navy-50 text-navy-800",
        brand: "border-navy-200 bg-navy-50 text-navy-800",
        ai: "border-iris-200 bg-iris-50 text-iris-700",
        solid: "border-navy-900 bg-solid text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-80" /> : null}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
