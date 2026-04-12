import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // HMR is disabled when DISABLE_HMR=true (used in AI Studio to prevent
    // hot-reload flickering during agent edits). Does not disable file watching.
    hmr: process.env.DISABLE_HMR !== 'true',
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
