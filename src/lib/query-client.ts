import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { normaliseError } from '@/api/errors';

/**
 * Default React Query behavior for the whole app:
 * - Retries turned way down: a 401/403/404 retried 3 × wastes a user's time.
 *   Mutations never retry silently (the UI shows the error inline).
 * - `edusphere:logout` (dispatched by the 401 interceptor) clears every cache
 *   entry so stale cross-tenant data can never partially survive a switch.
 */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } })?.response?.status ?? 0;
        // Retry transient network/server hiccups, never auth or client errors.
        if (status === 0 || status >= 500) return failureCount < 2;
        return false;
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
      onError: (error) => {
        const parsed = normaliseError(error);
        // Mutations surface their failure in-place via the form; a toast here is
        // redundant noise unless the call happened outside a form context.
        toast.error(parsed.message);
      },
    },
  },
});

if (typeof window !== 'undefined') {
  window.addEventListener('edusphere:logout', () => {
    queryClient.clear();
  });
}