import { AlertTriangle, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Shared error state for a failed query — rendered instead of an empty state so
 * a failed fetch is never mistaken for "nothing here yet".
 */
interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Couldn't load this data",
  description = 'Something went wrong while fetching. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/15 text-warning">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
        <p className="mt-3 text-sm font-medium">{title}</p>
        {description ? (
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
        {onRetry ? (
          <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden /> Try again
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}