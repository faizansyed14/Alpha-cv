"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@/components/icons";

import { cn } from "@/lib/utils";

/**
 * Radix modal dialogs set `disableOutsidePointerEvents` on the content layer, which blocks clicks to portaled UI (select menus,
 * popovers). We default to `modal={false}` and render our own backdrop so overlays still look modal while portaled layers remain
 * interactive. See radix-ui/primitives#3119.
 */
function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} modal={false} />;
}

const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-scrim/45 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out", className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

function isOutsideClickFromPortaledOverlay(target: EventTarget | null) {
  if (!target || !(target instanceof Element)) return false;
  return !!(
    target.closest("[data-managed-select-panel]") ||
    target.closest("[data-radix-select-content]") ||
    target.closest("[data-radix-popover-content]") ||
    target.closest("[data-radix-dropdown-menu-content]")
  );
}

/** Backdrop when `modal={false}`: Radix does not render `DialogOverlay` in that mode. */
function DialogBackdrop() {
  return <div className="fixed inset-0 z-50 animate-fade-in bg-scrim/45 backdrop-blur-[2px]" aria-hidden />;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { /** Omit the built-in X when the content draws its own. */ hideClose?: boolean }
>(({ className, children, onPointerDownOutside, onFocusOutside, onInteractOutside, hideClose, ...props }, ref) => (
  <DialogPortal>
    <DialogBackdrop />
    <DialogPrimitive.Content
      ref={ref}
      onPointerDownOutside={(e) => {
        if (isOutsideClickFromPortaledOverlay(e.target)) e.preventDefault();
        onPointerDownOutside?.(e);
      }}
      onInteractOutside={(e) => {
        if (isOutsideClickFromPortaledOverlay(e.target)) e.preventDefault();
        onInteractOutside?.(e);
      }}
      onFocusOutside={(e) => {
        const rel = (e as unknown as CustomEvent<{ originalEvent: FocusEvent }>).detail?.originalEvent?.relatedTarget;
        if (isOutsideClickFromPortaledOverlay(e.target) || (rel instanceof Element && isOutsideClickFromPortaledOverlay(rel))) e.preventDefault();
        onFocusOutside?.(e);
      }}
      className={cn(
        "fixed left-1/2 top-1/2 z-[51] grid max-h-[min(92dvh,920px)] w-[calc(100%-1.25rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-paper p-4 shadow-pop sm:w-[calc(100%-2rem)] sm:p-6",
        "data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
        className
      )}
      {...props}
    >
      {children}
      {hideClose ? null : (
        <DialogPrimitive.Close className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:shadow-glow disabled:pointer-events-none sm:right-4 sm:top-4 sm:h-8 sm:w-8">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 pr-8 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 border-t border-surface-border pt-4 sm:flex-row sm:justify-end", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold leading-tight tracking-[-0.02em] text-slate-900", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-slate-500", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export { Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
