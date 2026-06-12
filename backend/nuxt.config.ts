export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  modules: [],
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

