import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Light navy CTA */
        primary: "bg-navy-500 text-paper shadow-sm hover:bg-navy-400 active:bg-navy-600",
        /** Legacy alias — same light navy CTA */
        default: "bg-navy-500 text-paper shadow-sm hover:bg-navy-400 active:bg-navy-600",
        /** Navy solid (dark surfaces / secondary primary) */
        navy: "bg-navy-800 text-paper shadow-sm hover:bg-navy-700 active:bg-navy-900",
        /** White + warm border */
        secondary:
          "border border-surface-border bg-paper text-ink shadow-sm hover:bg-offwhite hover:text-navy-800",
        outline:
          "border border-surface-border bg-paper text-ink shadow-sm hover:bg-offwhite hover:text-navy-800",
        ghost: "text-ink-muted hover:bg-navy-50 hover:text-navy-800",
        danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
        /** Legacy alias for danger */
        destructive: "bg-red-600 text-white shadow-sm hover:bg-red-700",
        link: "text-navy-500 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-xs",
        md: "h-9 px-3.5",
        default: "h-9 px-3.5",
        lg: "h-10 rounded-md px-5",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Optional leading icon (lucide icon at 16px works best) */
  icon?: React.ReactNode;
  /** Shows a spinner and disables the button */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, icon, loading = false, disabled, children, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
