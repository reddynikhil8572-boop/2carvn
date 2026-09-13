import { Link } from 'react-router-dom';
import { ArrowLeft, FileQuestion } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <FileQuestion className="h-12 w-12 text-muted-foreground" aria-hidden />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The page you're looking for doesn't exist or has moved.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link to="/dashboard">
          <ArrowLeft className="mr-2" aria-hidden />
          Back to dashboard
        </Link>
      </Button>
    </div>
  );
}