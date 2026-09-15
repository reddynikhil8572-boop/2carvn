import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * Shared frame for unauthenticated pages: brand panel on the left (desktop),
 * form column with animated entrance on the right.
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
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight">2carvn</span>
        </Link>
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="max-w-md text-3xl font-semibold leading-tight"
          >
            One platform for your whole school.
          </motion.h1>
          <p className="mt-3 max-w-md text-primary-foreground/80">
            Courses, classes, quizzes and certificates — multi-tenant by design,
            with your data held behind strict row-level isolation.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/60">
          2carvn · Privacy-friendly by default
        </p>
      </div>

      {/* Form column */}
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm"
        >
          {/* Mobile brand */}
          <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-lg font-semibold tracking-tight">2carvn</span>
          </div>
          {children}
          {footer ? <div className="mt-6 text-center text-sm">{footer}</div> : null}
        </motion.div>
      </div>
    </div>
  );
}