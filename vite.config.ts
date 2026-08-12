import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => ({
  /**
   * `--mode public` builds a distribution with no expense tracking module at
   * all: the entry point is hidden and the ETM chunk (crypto, vault, UI) is
   * dead-code-eliminated, so it is not even downloadable. The default build
   * keeps the module, so existing deploys are unchanged.
   */
  define: {
    __ETM_AVAILABLE__: JSON.stringify(mode !== 'public'),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        name: 'Tidewater',
        short_name: 'Tidewater',
        description: 'A calm way to see that you have what you need.',
        theme_color: '#0f766e',
        background_color: '#f6f4ee',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['finance', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
}))
