import { useEffect, useRef, useState } from 'react';
import { Timer } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Live countdown to a quiz attempt's server-enforced `expiresAt`.
 *
 * The backend hard-expires attempts (status EXPIRED) whether or not the client
 * submits, so the UI must reflect the deadline and stop accepting answers.
 * Ticking in the component keeps the attempt's own deadline authoritative —
 * no client-side clock arithmetic beyond `expiresAt`.
 */

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface QuizCountdownProps {
  /** Server-set attempt deadline (ISO string). */
  expiresAt: string;
  /** Fired exactly once, on the moment the countdown crosses zero. */
  onExpire?: () => void;
  className?: string;
}

export function QuizCountdown({ expiresAt, onExpire, className }: QuizCountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = new Date(expiresAt).getTime() - now;
  const expired = remaining <= 0;

  useEffect(() => {
    if (expired && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-sm font-medium tabular-nums',
        expired
          ? 'text-destructive'
          : remaining < 60_000
            ? 'text-warning'
            : 'text-muted-foreground',
        className,
      )}
      role="timer"
      aria-live="polite"
      aria-label={expired ? 'Time expired' : 'Time remaining'}
    >
      <Timer className="h-4 w-4" aria-hidden />
      {expired ? 'Time expired' : formatRemaining(remaining)}
    </span>
  );
}