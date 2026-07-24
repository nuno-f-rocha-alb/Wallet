import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// The vendored OCR assets live at stable /tesseract/* URLs, so a CacheFirst entry would keep
// serving the old worker/core/lang after a tesseract.js upgrade — new bundle, stale wasm, broken
// OCR. Key the cache on the installed version so an upgrade starts a fresh one.
const tesseractVersion = (createRequire(import.meta.url)('tesseract.js/package.json') as { version: string }).version;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The vendored Tesseract runtime is ~25 MB of wasm — far past the precache limit and
        // only needed when scanning a receipt. Keep it out of the install-time bundle and
        // cache it on first use instead, so OCR still works offline after one scan.
        globIgnores: ['**/tesseract/**'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: `tesseract-runtime-v${tesseractVersion}`,
              // Bounded so a superseded cache can't pin ~25 MB forever.
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 180, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Wallet',
        short_name: 'Wallet',
        description: 'Personal finance tracker',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  // Dev-only: proxy API to the Fastify server (prod serves both from one origin).
  server: { proxy: { '/api': 'http://localhost:8080' } },
});
