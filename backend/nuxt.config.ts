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
    experimental: {
      openAPI: false
    }
  },
  typescript: {
    strict: true
  }
})
