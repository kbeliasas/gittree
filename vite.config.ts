import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev (`pnpm dev`), scripts/dev.ts starts the API server and passes its port
// here; /api and /auth are proxied to it. changeOrigin rewrites the Host header
// to 127.0.0.1:<apiPort>, which is what the server's Host check expects.
const apiPort = process.env.GITTREE_API_PORT;
const proxyTarget = apiPort ? `http://127.0.0.1:${apiPort}` : undefined;

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  // The graph worker is an ES module; the CSP allows it because it's a same-origin file, not a blob.
  worker: { format: 'es' },
  server: proxyTarget
    ? {
        proxy: {
          '/api': { target: proxyTarget, changeOrigin: true },
          '/auth': { target: proxyTarget, changeOrigin: true },
        },
      }
    : {},
});
