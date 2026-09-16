/**
 * Runtime environment config. All values are frontend-safe — no secrets here.
 * The backend URL is the only required value; everything else has sensible
 * defaults.
 */

export const env = {
  apiBaseUrl:
    import.meta.env.VITE_API_BASE_URL ??
    (import.meta.env.DEV
      ? `${window.location.protocol}//${window.location.hostname}:5000`
      : 'https://edusphere-api.onrender.com'),
  appName: import.meta.env.VITE_APP_NAME ?? '2carvn',
} as const;
