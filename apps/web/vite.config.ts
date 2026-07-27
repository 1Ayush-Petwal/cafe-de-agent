import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // No rewrite: the API serves under `/api` in every environment (see
    // apps/api/src/main.ts), so dev and prod hit identical paths.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
});
