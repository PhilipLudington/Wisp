import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dashboard SPA build config.
 *
 * The app lives in `web/` and builds to `dist/web/`, which the Hono process
 * serves as static assets (see `src/web/serve.ts`) — there is no separate
 * frontend server in production. In dev, `vite` runs its own server and proxies
 * the API/ingest/tracker routes to the Hono process so both halves work
 * together over one origin.
 */
const API_TARGET = process.env.WISP_API_TARGET ?? 'http://localhost:3000';

const proxy = {
  '/api': API_TARGET,
  '/e': API_TARGET,
  '/wisp.js': API_TARGET,
  '/health': API_TARGET,
};

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: { proxy },
  preview: { proxy },
});
