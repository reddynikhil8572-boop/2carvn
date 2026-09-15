import { Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';

import { useAuthUser } from '@/stores/auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

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
          <motion.div
            key={location.pathname}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <Outlet />
          </motion.div>
        </main>
        <footer className="border-t py-4 text-center text-xs text-muted-foreground">
          2carvn · Multi-tenant education platform
        </footer>
      </div>
    </div>
  );
}