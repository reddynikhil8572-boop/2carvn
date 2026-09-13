/**
 * Runtime environment config. All values are frontend-safe — no secrets here.
 * The backend URL is the only required value; everything else has sensible
 * defaults.
 */

export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000',
  appName: import.meta.env.VITE_APP_NAME ?? 'EduSphere',
} as const;
