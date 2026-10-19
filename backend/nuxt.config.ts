import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  experimental: {
    appManifest: false
  },
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }
      ]
    }
  },
  css: ['~/assets/css/main.css'],
  modules: [],
  alias: {
    '@playlet-shared': fileURLToPath(new URL('../shared', import.meta.url))
  },
  runtimeConfig: {
    dataDir: process.env.PLAYLET_ADMIN_DATA_DIR || './data',
    public: {
      appName: 'Playlet Admin'
    }
  },
  nitro: {
    // Nitro's dev error formatter uses source-map's WASM consumer, which can trap
    // under Bun. Keep stack mapping with the API-compatible JavaScript consumer.
    alias: {
      'source-map': fileURLToPath(new URL('./node_modules/source-map-js/source-map.js', import.meta.url))
    },
    serverAssets: [{
      baseName: 'default-prompts',
      dir: fileURLToPath(new URL('../src-tauri/assets/default-prompts', import.meta.url))
    }],
    experimental: {
      openAPI: false
    }
  },
  typescript: {
    strict: true
  }
})
