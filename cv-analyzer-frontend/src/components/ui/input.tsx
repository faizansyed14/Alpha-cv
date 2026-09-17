import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  // Additional props can be added here
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[13px] text-gray-900 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-[13px] file:font-medium placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 focus-visible:border-brand-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
