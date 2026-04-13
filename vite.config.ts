import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Target modern browsers only — drops legacy polyfills and enables
    // smaller output (optional chaining, nullish coalescing, top-level
    // await are all native).
    target: 'esnext',
    // Speed up production builds by skipping per-chunk gzip size reporting.
    // Actual compression is handled by the Express compression middleware.
    reportCompressedSize: false,
    cssMinify: 'lightningcss',
  },
  server: {
    // HMR is disabled when DISABLE_HMR=true (used in AI Studio to prevent
    // hot-reload flickering during agent edits). Does not disable file watching.
    hmr: process.env.DISABLE_HMR !== 'true',
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
