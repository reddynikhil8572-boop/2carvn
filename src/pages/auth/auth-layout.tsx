import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * Shared frame for unauthenticated pages: brand panel on the left (desktop),
 * form column with animated entrance on the right.
 * Brand panel features floating glassmorphism orbs for visual depth.
 */
export function AuthLayout({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-primary via-primary to-indigo-900 text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* Floating glassmorphism orbs */}
        <motion.div
          className="absolute -top-20 -left-20 h-80 w-80 rounded-full bg-white/10 blur-3xl"
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-10 right-0 h-64 w-64 rounded-full bg-indigo-400/20 blur-3xl"
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5 blur-2xl"
          animate={{ x: [0, 20, -20, 0], y: [0, -15, 10, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        />

        <Link to="/" className="relative flex items-center gap-2">
          <motion.span
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15"
            whileHover={{ scale: 1.1, rotate: -5, transition: { duration: 0.2 } }}
          >
            <GraduationCap className="h-5 w-5" aria-hidden />
          </motion.span>
          <span className="text-lg font-semibold tracking-tight">2carvn</span>
        </Link>

        <div className="relative">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-md text-3xl font-semibold leading-tight"
          >
            One platform for your whole school.
          </motion.h1>
          <motion.p
            className="mt-3 max-w-md text-primary-foreground/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Courses, classes, quizzes and certificates — multi-tenant by design,
            with your data held behind strict row-level isolation.
          </motion.p>

          {/* Floating stat pills */}
          <div className="mt-8 flex flex-wrap gap-3">
            {[
              { label: 'Multi-tenant', value: '✓' },
              { label: 'Role-based', value: '✓' },
              { label: 'Privacy-first', value: '✓' },
            ].map((pill, i) => (
              <motion.div
                key={pill.label}
                className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm backdrop-blur-sm"
                initial={{ opacity: 0, scale: 0.8, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.35 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ scale: 1.05, backgroundColor: 'rgba(255,255,255,0.18)' }}
              >
                <span className="font-semibold text-white">{pill.value}</span>
                <span className="text-primary-foreground/80">{pill.label}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-primary-foreground/60">
          2carvn · Privacy-friendly by default
        </p>
      </div>

      {/* Form column */}
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm"
        >
          {/* Mobile brand */}
          <motion.div
            className="mb-8 flex items-center justify-center gap-2 lg:hidden"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-lg font-semibold tracking-tight">2carvn</span>
          </motion.div>
          {children}
          {footer ? <div className="mt-6 text-center text-sm">{footer}</div> : null}
        </motion.div>
      </div>
    </div>
  );
}