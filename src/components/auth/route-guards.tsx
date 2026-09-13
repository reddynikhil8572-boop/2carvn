import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useSession } from '@/hooks/useAuth';
import { useAuthUser } from '@/stores/auth';
import type { UserRole } from '@/types/api';

/**
 * Route guards. `<RequireAuth>` gates anything that needs a session;
 * `<RequireRole roles={[...]}>` additionally limits to specific roles.
 *
 * Both handle the session-loading state by rendering nothing rather than a
 * flash of the login page, so the guard jump is never visible.
 */

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, authenticated } = useSession();
  const location = useLocation();

  if (loading) return <CenteredLoader />;
  if (!authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function RequireRole({
  roles,
  children,
}: {
  roles: readonly UserRole[];
  children: React.ReactNode;
}) {
  const user = useAuthUser();

  if (!user) return null;
  if (!roles.includes(user.role)) {
    return <Navigate to="/forbidden" replace />;
  }
  return <>{children}</>;
}

export function CenteredLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center" role="status">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Loading</span>}
      </div>
    </div>
  );
}