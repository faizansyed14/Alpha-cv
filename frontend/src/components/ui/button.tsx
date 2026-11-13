import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * Buttons. One primary per screen (solid brand, a hairline of light along its top edge); secondary is a quiet outlined surface;
 * soft is a tinted fill for a positive secondary action; ghost sits in toolbars and rows. Every variant presses down a touch.
 */
const PRIMARY =
  "relative isolate overflow-hidden bg-solid text-white shadow-sheen before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-btn-sheen before:content-[''] hover:bg-solid-hover active:translate-y-px active:shadow-soft";
const SECONDARY =
  "border border-slate-200 bg-paper text-slate-700 shadow-soft hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:translate-y-px";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold tracking-[-0.01em] transition-[background-color,border-color,color,opacity,box-shadow,transform] duration-150 ease-out focus-visible:outline-none focus-visible:shadow-glow disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: PRIMARY,
        default: PRIMARY,
        navy: PRIMARY,
        secondary: SECONDARY,
        outline: SECONDARY,
        soft: "bg-navy-50 text-navy-900 ring-1 ring-inset ring-navy-100 hover:bg-navy-100 active:translate-y-px",
        ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200/70",
        danger: "border border-red-200 bg-paper text-red-600 shadow-soft hover:border-red-300 hover:bg-red-50 active:translate-y-px",
        destructive: "bg-red-600 text-white shadow-sheen hover:bg-red-700 active:translate-y-px",
        link: "h-auto px-0 text-navy-800 underline-offset-4 hover:underline",
        /** The AI action: a brand-to-iris gradient, used once per screen at most */
        ai: "relative isolate overflow-hidden bg-iris-gradient text-white shadow-sheen before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-btn-sheen before:content-[''] hover:brightness-110 active:translate-y-px",
      },
      size: {
        xs: "h-7 gap-1 rounded-md px-2 text-xs [&_svg]:size-3.5",
        sm: "h-8 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-9 px-3.5",
        default: "h-9 px-3.5",
        lg: "h-10 px-5 text-base",
        xl: "h-11 px-6 text-base rounded-xl",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8 [&_svg]:size-3.5",
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
  icon?: React.ReactNode;
  /** An icon after the label (an arrow, a chevron) */
  trailingIcon?: React.ReactNode;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, icon, trailingIcon, loading = false, disabled, children, type = "button", ...props }, ref) => {
    return (
      <button
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" /> : icon}
        {children}
        {trailingIcon}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
