'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ease } from '@/lib/motion';

type Pos = { x: number; y: number };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function centerOf(el: Element, root: DOMRect): Pos {
  const r = el.getBoundingClientRect();
  return {
    x: r.left - root.left + r.width / 2,
    y: r.top - root.top + r.height / 2,
  };
}

/** Big visible mouse that moves to [data-tour] targets and pulses a click. */
export default function TourCursor({
  rootRef,
  targets,
  stepKey,
  onComplete,
  onTargetClick,
  lockPageScroll = false,
}: {
  rootRef: React.RefObject<HTMLElement | null>;
  targets?: string[];
  stepKey: string | number;
  /** Fires after the last click. */
  onComplete?: () => void;
  /** Fires when a target is clicked (after the click pulse starts). */
  onTargetClick?: (id: string) => void;
  /** When true, never call scrollIntoView (avoids yanking the host page). */
  lockPageScroll?: boolean;
}) {
  const [pos, setPos] = useState<Pos>({ x: 120, y: 120 });
  const [visible, setVisible] = useState(false);
  const [clicking, setClicking] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!targets?.length) {
      setVisible(false);
      setClicking(false);
      setLabel(null);
      return;
    }

    const run = async () => {
      await sleep(450);
      if (cancelled) return;
      setVisible(true);

      for (const id of targets) {
        if (cancelled) return;
        const rootEl = rootRef.current;
        if (!rootEl) continue;
        const el = rootEl.querySelector(`[data-tour="${id}"]`);
        if (!el) continue;

        if (!lockPageScroll) {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } else {
          // Keep scroll inside the tour root only
          const cRect = rootEl.getBoundingClientRect();
          const eRect = el.getBoundingClientRect();
          const delta = eRect.top - cRect.top - cRect.height / 2 + eRect.height / 2;
          rootEl.scrollTop += delta;
        }
        const next = centerOf(el, rootEl.getBoundingClientRect());
        setClicking(false);
        setLabel(el.getAttribute('data-tour-label'));
        setPos(next);

        // Slower move so the path is readable
        await sleep(950);
        if (cancelled) return;

        setClicking(true);
        el.setAttribute('data-tour-active', 'true');
        onTargetClick?.(id);
        await sleep(420);
        if (cancelled) return;
        el.removeAttribute('data-tour-active');
        setClicking(false);
        await sleep(320);
      }

      if (!cancelled) onComplete?.();
    };

    void run();
    return () => {
      cancelled = true;
      rootRef.current?.querySelectorAll('[data-tour-active]').forEach((n) => n.removeAttribute('data-tour-active'));
    };
  }, [targets, stepKey, rootRef, onComplete, onTargetClick, lockPageScroll]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="pointer-events-none absolute z-[60]"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{
            opacity: 1,
            scale: clicking ? 0.88 : 1,
            left: pos.x,
            top: pos.y,
          }}
          exit={{ opacity: 0 }}
          transition={{
            left: { duration: 0.85, ease },
            top: { duration: 0.85, ease },
            scale: { duration: 0.12 },
            opacity: { duration: 0.2 },
          }}
          style={{ translate: '-2px -2px' }}
        >
          <AnimatePresence>
            {clicking && (
              <motion.span
                key="ripple"
                className="absolute left-0 top-0 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-navy-600 bg-navy-500/20"
                initial={{ scale: 0.4, opacity: 0.9 }}
                animate={{ scale: 2.2, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease }}
              />
            )}
          </AnimatePresence>

          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            className="relative drop-shadow-[0_4px_10px_rgba(15,23,42,0.45)]"
            aria-hidden
          >
            <path
              d="M5.5 3.5 L5.5 18.5 L9.2 14.9 L12.2 21.2 L14.4 20.2 L11.3 13.7 L16.5 13.7 Z"
              fill="#0f172a"
              stroke="#fff"
              strokeWidth="1.25"
              strokeLinejoin="round"
            />
          </svg>

          {label && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute left-7 top-5 whitespace-nowrap rounded-lg border border-navy-200 bg-navy-900 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg"
            >
              {clicking ? `Click ${label}` : `Go to ${label}`}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Highlight ring while the tour cursor is aiming at / clicking a target. */
export const tourTargetClass =
  'data-[tour-active=true]:ring-2 data-[tour-active=true]:ring-navy-500 data-[tour-active=true]:ring-offset-2 data-[tour-active=true]:scale-[1.02] transition-[box-shadow,transform] duration-200';
