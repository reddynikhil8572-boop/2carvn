import { useSyncExternalStore } from 'react';

import type { AuthUser } from '@/types/models';

/**
 * Tiny global store for the signed-in user. Auth lives in HTTP-only cookies;
 * this module only mirrors the *profile* in memory so the shell can render
 * without waiting on the network. It is never a token store.
 */

type State = { user: AuthUser | null };

let state: State = { user: null };

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setUser(user: AuthUser | null) {
  state = { user };
  emit();
}

/** Called by the client's 401 interceptor (via `edusphere:logout`). */
function forceLogout() {
  setUser(null);
}

if (typeof window !== 'undefined') {
  window.addEventListener('edusphere:logout', forceLogout);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AuthUser | null {
  return state.user;
}

export function useAuthUser(): AuthUser | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}