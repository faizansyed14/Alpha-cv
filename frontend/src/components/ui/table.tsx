import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Data table primitives: a paper card with a quiet, uppercase header row, hairline dividers and a soft hover.
 *
 *   <Table>
 *     <THead><TR><TH>Name</TH><TH>Status</TH></TR></THead>
 *     <TBody><TR><TD>Jane Doe</TD><TD><Badge variant="success">Active</Badge></TD></TR></TBody>
 *   </Table>
 */
const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement> & { /** Keep the header visible while the body scrolls */ stickyHeader?: boolean; wrapperClassName?: string }
>(({ className, stickyHeader, wrapperClassName, ...props }, ref) => (
  <div className={cn("relative w-full max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-surface-border bg-paper shadow-card [-webkit-overflow-scrolling:touch]", wrapperClassName)}>
    <table
      ref={ref}
      className={cn("w-full caption-bottom border-collapse text-sm", stickyHeader && "[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-[1]", className)}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

const THead = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("border-b border-surface-border bg-slate-50/90 backdrop-blur", className)} {...props} />
));
THead.displayName = "THead";

const TBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("divide-y divide-surface-border/70", className)} {...props} />
));
TBody.displayName = "TBody";

const TR = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn("transition-colors duration-150 hover:bg-navy-50/40 data-[selected=true]:bg-navy-50/70", className)} {...props} />
));
TR.displayName = "TR";

/** Uppercase 11px column header. */
const TH = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn("h-10 whitespace-nowrap px-4 text-left text-2xs font-semibold uppercase tracking-[0.06em] text-slate-500", className)}
    {...props}
  />
));
TH.displayName = "TH";

/** Compact data cell. */
const TD = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("px-4 py-3 align-middle text-sm text-slate-700", className)} {...props} />
));
TD.displayName = "TD";

export { Table, THead, TBody, TR, TH, TD };
