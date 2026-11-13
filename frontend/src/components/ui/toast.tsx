'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from '@/components/icons';
import { cn } from '@/lib/utils';
import { ease } from '@/lib/motion';

export interface ToastProps {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  onClose: (id: string) => void;
}

const LOOK = {
  success: { Icon: CheckCircle, tile: 'bg-emerald-50 text-emerald-600 ring-emerald-100', bar: 'bg-emerald-500' },
  error: { Icon: AlertCircle, tile: 'bg-red-50 text-red-600 ring-red-100', bar: 'bg-red-500' },
  warning: { Icon: AlertTriangle, tile: 'bg-amber-50 text-amber-600 ring-amber-100', bar: 'bg-amber-500' },
  info: { Icon: Info, tile: 'bg-navy-50 text-navy-700 ring-navy-100', bar: 'bg-solid-soft' },
} as const;

/** One notification: a glass card with a coloured icon tile and a thin bar that counts the time down. Hovering pauses it. */
export function Toast({ id, type, title, message, duration = 4000, onClose }: ToastProps) {
  const [paused, setPaused] = useState(false);
  const left = useRef(duration);
  const started = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => onClose(id), [id, onClose]);

  useEffect(() => {
    if (paused) {
      if (timer.current) clearTimeout(timer.current);
      left.current -= Date.now() - started.current;
      return;
    }
    started.current = Date.now();
    timer.current = setTimeout(close, Math.max(0, left.current));
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [paused, close]);

  const { Icon, tile, bar } = LOOK[type] ?? LOOK.success;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.97, transition: { duration: 0.16, ease } }}
      transition={{ duration: 0.26, ease }}
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="glass w-full max-w-sm overflow-hidden rounded-xl"
    >
      <div className="flex items-start gap-3 p-3.5">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', tile)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          {message ? <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{message}</p> : null}
        </div>
        <button type="button" onClick={close} aria-label="Dismiss" className="-mr-1 -mt-1 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="h-0.5 w-full bg-slate-100">
        <div
          className={cn('h-full', bar)}
          style={{ animation: `toast-shrink ${duration}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      </div>
    </motion.div>
  );
}

export interface ToastContainerProps {
  toasts: ToastProps[];
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[9999] flex w-full max-w-sm flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast {...toast} onClose={onClose} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Local toast state for a page. */
export function useToast() {
  const [toasts, setToasts] = useState<ToastProps[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<ToastProps, 'id' | 'onClose'>) => {
    const id = Math.random().toString(36).slice(2, 11);
    setToasts((prev) => [...prev.slice(-4), { ...toast, id, onClose: removeToast }]);   // at most five on screen
  }, [removeToast]);

  const showSuccess = useCallback((title: string, message?: string) => addToast({ type: 'success', title, message }), [addToast]);
  const showError = useCallback((title: string, message?: string) => addToast({ type: 'error', title, message, duration: 6000 }), [addToast]);
  const showWarning = useCallback((title: string, message?: string) => addToast({ type: 'warning', title, message }), [addToast]);
  const showInfo = useCallback((title: string, message?: string) => addToast({ type: 'info', title, message }), [addToast]);

  return { toasts, showSuccess, showError, showWarning, showInfo, removeToast };
}
