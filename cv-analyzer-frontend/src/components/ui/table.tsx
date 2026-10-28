import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Composable ERP data table primitives.
 *
 * Usage:
 *   <Table>
 *     <THead>
 *       <TR><TH>Name</TH><TH>Status</TH></TR>
 *     </THead>
 *     <TBody>
 *       <TR><TD>Jane Doe</TD><TD><Badge variant="success">Active</Badge></TD></TR>
 *     </TBody>
 *   </Table>
 */

/** White card wrapper with horizontal scroll for the table. */
const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-[var(--shadow-sm)]">
    <table
      ref={ref}
      className={cn("w-full caption-bottom border-collapse text-[13px]", className)}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

const THead = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("border-b border-slate-200 bg-slate-50/80", className)}
    {...props}
  />
));
THead.displayName = "THead";

const TBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("divide-y divide-gray-100", className)}
    {...props}
  />
));
TBody.displayName = "TBody";

const TR = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn("transition-colors hover:bg-slate-50/60", className)}
    {...props}
  />
));
TR.displayName = "TR";

/** Uppercase 11px gray-500 column header. */
const TH = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500",
      className
    )}
    {...props}
  />
));
TH.displayName = "TH";

/** Compact data cell: py-2.5, 13px. */
const TD = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("px-4 py-2.5 align-middle text-[13px] text-slate-700", className)}
    {...props}
  />
));
TD.displayName = "TD";

export { Table, THead, TBody, TR, TH, TD };
