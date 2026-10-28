import type { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';

import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center',
        className,
      )}
    >
      <motion.span
        className="flex h-12 w-12 items-center justify-center rounded-full bg-muted"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        whileHover={{ scale: 1.1, rotate: [0, -8, 8, 0], transition: { duration: 0.4 } }}
      >
        <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
      </motion.span>
      <motion.h3
        className="mt-4 text-base font-semibold"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        {title}
      </motion.h3>
      {description ? (
        <motion.p
          className="mt-1 max-w-sm text-sm text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.25 }}
        >
          {description}
        </motion.p>
      ) : null}
      {action ? (
        <motion.div
          className="mt-5"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          {action}
        </motion.div>
      ) : null}
    </motion.div>
  );
}