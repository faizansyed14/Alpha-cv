'use client';

import { motion } from 'framer-motion';
import { ease } from '@/lib/motion';

/**
 * A template (unlike a layout) is mounted again on every navigation, so each page arrives with the same short fade
 * and rise. Only opacity and a few pixels move: the sidebar stays still and the page never feels slow.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease }}>
      {children}
    </motion.div>
  );
}
