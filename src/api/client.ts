import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { env } from '@/config/env';

/**
 * Shared Axios instance. Every API module imports `api` — never create a new
 * instance.
 *
 * Auth cookies (`edusphere_at` / `edusphere_rt`) are HTTP-only and sent
 * automatically. `withCredentials: true` is non-negotiable.
 */

export const api = axios.create({
  baseURL: `${env.apiBaseUrl}/api/v1`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// ── 401 refresh-once interceptor ───────────────────────────────────────────
//
// Tracks whether a refresh is already in-flight so concurrent 401s do not
// trigger multiple refresh calls. On the second 401 (after a failed or
// in-progress refresh) the user is logged out — no infinite loop.

let refreshPromise: Promise<boolean> | null = null;

function isRefreshRequest(config: InternalAxiosRequestConfig): boolean {
  return config.url === '/auth/refresh' || config.url?.startsWith('/auth/refresh') === true;
}

function isSessionProbe(config: InternalAxiosRequestConfig): boolean {
  return config.url === '/auth/me' || config.url?.startsWith('/auth/me?') === true;
}

async function attemptRefresh(): Promise<boolean> {
  try {
    const res = await axios.post(
      `${env.apiBaseUrl}/api/v1/auth/refresh`,
      null,
      { withCredentials: true },
    );
    return res.data?.success === true;
  } catch {
    return false;
  }
}

function forceLogout() {
  // Clear React Query cache + auth state. We avoid importing stores here to
  // keep the dependency graph acyclic — AuthProvider listens for this event.
  window.dispatchEvent(new CustomEvent('edusphere:logout'));
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // Only handle 401s, and never retry the refresh endpoint itself.
    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      isRefreshRequest(originalRequest)
    ) {
      return Promise.reject(error);
    }

    // If a refresh is already running, wait for it instead of starting another.
    if (!refreshPromise) {
      refreshPromise = attemptRefresh();
    }

    const refreshed = await refreshPromise;

    // Always release the shared promise so the next 401 can attempt a fresh
    // refresh (the backend rotates the cookie each time).
    refreshPromise = null;

    if (refreshed) {
      originalRequest._retry = true;
      return api(originalRequest);
    }

    // The initial session probe is allowed to fail so the router can send an
    // anonymous visitor to /login. Clearing that query while it is resolving
    // would recreate it and leave the home route stuck on its loader.
    if (!isSessionProbe(originalRequest)) forceLogout();
    return Promise.reject(error);
  },
);

// ── Authenticated user reference ───────────────────────────────────────────
//
// AuthProvider writes to this module so the client can attach the current
// user's language preference to requests without introducing a circular
// dependency.

let currentUser: { language?: string } | null = null;

export function setCurrentUser(user: { language?: string } | null) {
  currentUser = user;
}

api.interceptors.request.use((config) => {
  if (currentUser?.language) {
    config.headers.set('Accept-Language', currentUser.language);
  }
  return config;
});
