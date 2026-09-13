import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import * as authApi from '@/api/auth';
import { setUser, useAuthUser } from '@/stores/auth';

export const authKeys = {
  me: ['auth', 'me'] as const,
  twoFactorStatus: ['auth', '2fa', 'status'] as const,
};

/**
 * Auth hooks. Errors are intentionally NOT swallowed here — the global
 * mutation toast in lib/query-client.ts surfaces failures, and pages catch the
 * rejected promise when they need field-level (validation) detail.
 */

/** Loads the signed-in session once on boot. Returns `loading` vs `authenticated`. */
export function useSession() {
  const currentUser = useAuthUser();

  const query = useQuery({
    queryKey: authKeys.me,
    queryFn: async () => {
      try {
        const me = await authApi.getMe();
        setUser(me);
        return { user: me, authenticated: true };
      } catch {
        setUser(null);
        return { user: null, authenticated: false };
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  return {
    loading: query.isLoading,
    user: query.data?.user ?? currentUser,
    authenticated: query.data?.authenticated ?? false,
  };
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: authApi.LoginPayload) => {
      const data = await authApi.login(payload);
      if (!data.twoFactorRequired) {
        // The login response carries a narrow profile (no avatarUrl or school
        // branding) — GET /auth/me is the only authoritative full profile, so
        // hydrate the session from it rather than the login payload.
        const me = await authApi.getMe();
        queryClient.setQueryData(authKeys.me, { user: me, authenticated: true });
        setUser(me);
      }
      return data;
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      // Even a failed POST /logout must end the session client-side.
      queryClient.clear();
      setUser(null);
      navigate('/login', { replace: true });
    },
  });
}

export function useTwoFactorVerify() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: authApi.verifyTwoFactor,
    onSuccess: async () => {
      try {
        const me = await authApi.getMe();
        queryClient.setQueryData(authKeys.me, { user: me, authenticated: true });
        setUser(me);
      } catch {
        setUser(null);
      }
      navigate('/', { replace: true });
    },
  });
}

export function useRequestPasswordReset() {
  return useMutation({ mutationFn: authApi.requestPasswordReset });
}

export function useResetPassword() {
  return useMutation({ mutationFn: authApi.resetPassword });
}

// ── 2FA management (settings) ──────────────────────────────────────────────

export function useTwoFactorStatus() {
  return useQuery({
    queryKey: authKeys.twoFactorStatus,
    queryFn: authApi.getTwoFactorStatus,
    staleTime: 60_000,
  });
}

export function useTwoFactorSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.setupTwoFactor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.twoFactorStatus }),
  });
}

export function useTwoFactorEnable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.enableTwoFactor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.twoFactorStatus }),
  });
}

export function useTwoFactorDisable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.disableTwoFactor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.twoFactorStatus }),
  });
}

export function useRegenerateRecoveryCodes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.regenerateRecoveryCodes,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.twoFactorStatus }),
  });
}