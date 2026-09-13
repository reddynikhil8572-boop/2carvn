import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function ForbiddenPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <Lock className="h-12 w-12 text-muted-foreground" aria-hidden />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Access denied</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        You don't have permission to view this page. If you believe this is a
        mistake, contact your school administrator.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}