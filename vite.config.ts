/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // The backend's CORS allow-list and FRONTEND_URL both point at 3000.
    port: 3000,
  },
  preview: {
    port: 3000,
  },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy vendor libraries (recharts pulls in d3, motion, the
        // form/validation stack) so each caches independently and the shared
        // baseline chunk stays under the 500 kB soft cap.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'vendor-charts';
          }
          if (id.includes('node_modules/framer-motion')) return 'vendor-motion';
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/@remix-run') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@tanstack')) return 'vendor-query';
          if (id.includes('node_modules/@radix-ui') || id.includes('node_modules/lucide-react')) {
            return 'vendor-ui';
          }
          if (
            id.includes('node_modules/react-hook-form') ||
            id.includes('node_modules/zod') ||
            id.includes('node_modules/@hookform')
          ) {
            return 'vendor-forms';
          }
          if (
            id.includes('node_modules/date-fns') ||
            id.includes('node_modules/sonner') ||
            id.includes('node_modules/axios') ||
            id.includes('node_modules/class-variance-authority') ||
            id.includes('node_modules/clsx') ||
            id.includes('node_modules/tailwind-merge')
          ) {
            return 'vendor-utils';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // Scope to the frontend's own tests — the default glob would sweep in the
    // backend's suite (backend-v2/tests), which needs its own DB setup.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});