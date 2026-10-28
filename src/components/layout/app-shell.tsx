import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

import { useAuthUser } from '@/stores/auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

const pageVariants = {
  initial: { opacity: 0, y: 12, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.99 },
};

const pageTransition = {
  duration: 0.3,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

/**
 * Authenticated application shell. Fixed sidebar ≥ lg; drawer on smaller
 * screens (opened from the header). Content animates in per navigation —
 * except when the user prefers reduced motion.
 */
export function AppShell() {
  const user = useAuthUser();
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r bg-sidebar lg:block">
        <Sidebar role={user?.role ?? 'STUDENT'} />
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        <Header />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              variants={reduceMotion ? undefined : pageVariants}
              initial={reduceMotion ? false : 'initial'}
              animate="animate"
              exit={reduceMotion ? undefined : 'exit'}
              transition={reduceMotion ? undefined : pageTransition}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
        <motion.footer
          className="border-t py-4 text-center text-xs text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.4 }}
        >
          2carvn · Multi-tenant education platform
        </motion.footer>
      </div>
    </div>
  );
}