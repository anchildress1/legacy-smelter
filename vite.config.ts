import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled when DISABLE_HMR=true (used in AI Studio to prevent
      // hot-reload flickering during agent edits). Does not disable file watching.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': 'http://localhost:8080',
      },
    },
  };
});
