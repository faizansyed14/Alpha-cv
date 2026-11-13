'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Premium mesh backdrop for Agentic mode only.
 * Cool white canvas + restrained navy / indigo glows (hero `#16204B`). No yellow, pink, or rainbow.
 *
 * calm   softens the mesh while a chat is running so answers stay readable
 * fixed  pins it to the window (unused for agentic; kept for flexibility)
 */
export function GradientBackdrop({ calm = false, fixed = false }: { calm?: boolean; fixed?: boolean }) {
  const still = useReducedMotion();
  const drift = (x: number[], y: number[], seconds: number) =>
    still ? undefined : { x, y, transition: { duration: seconds, repeat: Infinity, ease: 'easeInOut' as const } };

  return (
    <div aria-hidden className={cn('pointer-events-none inset-0 -z-10 overflow-hidden', fixed ? 'fixed' : 'absolute')}>
      {/* Quiet cool base — premium SaaS canvas */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 50% -10%, #FFFFFF 0%, #F4F7FC 42%, #E8EEF7 72%, #DEE6F2 100%)',
        }}
      />

      {/* Slow mesh wash — navy ↔ soft indigo, never muddy mid-blue slabs */}
      <motion.div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(118deg, rgba(255,255,255,0.92) 0%, rgba(232,238,247,0.75) 28%, rgba(196,210,235,0.55) 52%, rgba(232,238,247,0.8) 76%, rgba(255,255,255,0.95) 100%)',
          backgroundSize: '280% 280%',
        }}
        animate={still ? undefined : { backgroundPosition: ['0% 40%', '100% 55%', '0% 40%'] }}
        transition={{ duration: 42, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={{ opacity: calm ? 0.38 : 0.92 }}
        transition={{ duration: 1.5 }}
      >
        {/* Top-left: soft sky lift */}
        <motion.div
          className="absolute -left-[18%] -top-[28%] h-[70%] w-[60%] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(125,162,224,0.45) 0%, transparent 68%)', filter: 'blur(8px)' }}
          animate={drift([0, 70, -25, 0], [0, 40, 15, 0], 32)}
        />
        {/* Top-right: deep hero navy (the brand) */}
        <motion.div
          className="absolute -right-[16%] -top-[12%] h-[62%] w-[55%] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(22,32,75,0.22) 0%, transparent 70%)', filter: 'blur(10px)' }}
          animate={drift([0, -60, 20, 0], [0, 55, 10, 0], 36)}
        />
        {/* Bottom center: indigo glow */}
        <motion.div
          className="absolute -bottom-[22%] left-[12%] h-[62%] w-[70%] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(74,107,200,0.32) 0%, transparent 68%)', filter: 'blur(12px)' }}
          animate={drift([0, 50, -35, 0], [0, -45, 20, 0], 40)}
        />
        {/* Soft highlight near center for depth */}
        <motion.div
          className="absolute left-[28%] top-[22%] h-[42%] w-[40%] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.7) 0%, transparent 70%)', filter: 'blur(20px)' }}
          animate={drift([0, 30, -20, 0], [0, -20, 15, 0], 44)}
        />
      </motion.div>

      {/* Fine grain so the mesh feels tactile, not flat */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-multiply"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
        }}
      />

      {/* Top vignette — keeps header readable */}
      <div className="absolute inset-0 bg-gradient-to-b from-paper/50 via-transparent to-paper/40" />
    </div>
  );
}
