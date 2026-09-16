/**
 * Runtime environment config. All values are frontend-safe — no secrets here.
 * The backend URL is the only required value; everything else has sensible
 * defaults.
 */

export const env = {
  apiBaseUrl: (() => {
    const configured = import.meta.env.VITE_API_BASE_URL?.trim();
    if (configured) return configured.replace(/\/+$/, '');

    // Same-origin by default: in production the frontend proxies `/api/v1` to the
    // backend (see vercel.json), so the auth cookies are first-party and are not
    // subject to third-party cookie blocking. In dev the API runs locally.
    return import.meta.env.DEV
      ? `${window.location.protocol}//${window.location.hostname}:5000`
      : window.location.origin;
  })(),
  appName: import.meta.env.VITE_APP_NAME ?? '2carvn',
} as const;
