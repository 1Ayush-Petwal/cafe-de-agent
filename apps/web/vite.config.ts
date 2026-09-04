import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Service worker only ships in production builds; dev keeps hitting
      // the API and Vite's own dev server directly with no SW in the way.
      devOptions: { enabled: false },
      manifest: {
        name: 'Café De App — Delhi table booking',
        short_name: 'Café De App',
        description: 'Find a table, hold it, confirm it — live café booking across Delhi.',
        display: 'standalone',
        start_url: '/',
        theme_color: '#7a4a1e',
        background_color: '#faf7f2',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App-shell-only precache: no runtimeCaching routes are configured,
        // so /api requests are never handled by the service worker at all —
        // they always go straight to the network. Availability is live
        // (SSE + 90s holds); a cached response here would show bookable
        // tables that aren't.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    // No rewrite: the API serves under `/api` in every environment (see
    // apps/api/src/main.ts), so dev and prod hit identical paths.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
});
