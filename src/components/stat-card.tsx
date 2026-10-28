import type { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Number card with an icon and optional trend hint. `delay` staggers the
 * entrance so a dashboard row reads as a single composition.
 * Hover: card lifts with a subtle shadow bloom; icon scales up gently.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  className,
  delay = 0,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4, scale: 1.02, transition: { duration: 0.2, ease: 'easeOut' } }}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
    >
      <Card className={cn('h-full overflow-hidden transition-shadow hover:shadow-lg', className)}>
        <CardContent className="flex items-start justify-between gap-3 p-5">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            <motion.p
              className="text-2xl font-semibold tracking-tight"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: delay + 0.15 }}
            >
              {value}
            </motion.p>
            {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          </div>
          <motion.span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            whileHover={{ rotate: [0, -8, 8, 0], scale: 1.15, transition: { duration: 0.4 } }}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </motion.span>
        </CardContent>
      </Card>
    </motion.div>
  );
}