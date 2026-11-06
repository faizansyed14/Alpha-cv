import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "@/components/icons";
import { cn } from "@/lib/utils";

const PRIMARY =
  "bg-navy-900 text-white shadow-[0_1px_2px_rgba(16,24,40,0.10),inset_0_1px_0_rgba(255,255,255,0.10)] hover:bg-navy-800 active:bg-navy-950";
const SECONDARY =
  "border border-surface-border bg-paper text-slate-700 shadow-soft hover:border-navy-300 hover:bg-navy-50 hover:text-navy-900";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[background-color,border-color,color,opacity,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:shadow-glow disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** The one primary action on a screen — deep hero navy */
        primary: PRIMARY,
        default: PRIMARY,
        navy: PRIMARY,
        secondary: SECONDARY,
        outline: SECONDARY,
        /** Quiet tint for a secondary positive action */
        soft: "bg-navy-50 text-navy-900 hover:bg-navy-100",
        ghost: "text-slate-600 hover:bg-navy-50 hover:text-navy-900",
        danger: "border border-red-200 bg-paper text-red-600 shadow-soft hover:border-red-300 hover:bg-red-50",
        destructive: "border border-red-200 bg-paper text-red-600 shadow-soft hover:border-red-300 hover:bg-red-50",
        link: "h-auto px-0 text-navy-800 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 gap-1.5 px-3 text-xs [&_svg]:size-3.5",
        md: "h-9 px-3.5 text-[13px]",
        default: "h-9 px-3.5 text-[13px]",
        lg: "h-10 px-5 text-sm",
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
