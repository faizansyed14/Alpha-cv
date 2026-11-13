import * as React from "react";
import { cn } from "@/lib/utils";

export const fieldClasses =
  "flex h-9 w-full rounded-lg border border-slate-200 bg-paper px-3 py-1.5 text-sm text-ink shadow-soft transition-[border-color,box-shadow,background-color] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-400 hover:border-navy-300 focus-visible:border-navy-500 focus-visible:outline-none focus-visible:shadow-glow disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus-visible:shadow-[0_0_0_3px_rgb(var(--red-500)/0.18)]";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** An icon drawn inside the field, on the left */
  leading?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, leading, ...props }, ref) => {
    if (!leading) {
      return <input type={type} className={cn(fieldClasses, className)} ref={ref} {...props} />;
    }
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 [&_svg]:size-4">{leading}</span>
        <input type={type} className={cn(fieldClasses, "pl-9", className)} ref={ref} {...props} />
      </div>
    );
  }
);
Input.displayName = "Input";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldClasses, "h-auto min-h-[88px] resize-y py-2 leading-relaxed", className)} {...props} />
  )
);
Textarea.displayName = "Textarea";

/** A label with an optional hint and required mark, for forms that build themselves. */
function Field({ label, hint, required, htmlFor, children, className }: { label: React.ReactNode; hint?: React.ReactNode; required?: boolean; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-700">
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-2xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export { Input, Textarea, Field };
