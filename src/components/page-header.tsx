import * as React from 'react';
import { motion } from 'framer-motion';

import { cn } from '@/lib/utils';

/** Consistent page header: eyebrow-less title block with optional actions. Animated entrance. */
export function PageHeader({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0 space-y-1">
        <motion.h1
          className="text-2xl font-semibold tracking-tight"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          {title}
        </motion.h1>
        {description ? (
          <motion.p
            className="text-sm text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            {description}
          </motion.p>
        ) : null}
      </div>
      {children ? (
        <motion.div
          className="flex shrink-0 items-center gap-2"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      ) : null}
    </div>
  );
}