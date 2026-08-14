import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the built app also runs from a plain folder or a subpath.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'יומן עבודה לעבודות בנייה',
        short_name: 'יומן עבודה',
        description:
          'רישום יומי של עובדים, ציוד ויציקות באתר בנייה, והפקת דוח PDF מעוצב בתבנית הטופס.',
        lang: 'he',
        dir: 'rtl',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#eceff4',
        // Matches the light top bar; the runtime swaps the meta tag per theme.
        theme_color: '#ffffff',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        /*
         * Precache everything: on site there is often no signal at all.
         *
         * `mjs` is in the list because of pdf.js — its worker ships as an ES
         * module, and without it the whole rendering half of "export as image"
         * would be an online-only feature in an app whose entire premise is
         * that it is not. It is the largest single file here by a distance, and
         * that is the price of the promise rather than an oversight.
         */
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        // The pdf.js worker is over Workbox's 2 MB default on its own.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
