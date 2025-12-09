// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // 模块
  modules: [
    '@nuxt/eslint',
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt',
    'shadcn-nuxt',
  ],

  // shadcn-vue 配置
  shadcn: {
    prefix: '',
    componentDir: '@/components/ui',
  },

  // 开发工具
  devtools: {
    enabled: true,
  },

  // CSS
  css: ['~/assets/css/main.css'],

  // 路由规则
  routeRules: {
    '/': { prerender: true },
  },

  // Nuxt 4 兼容性设置
  compatibilityDate: '2025-01-15',

  // 运行时配置
  runtimeConfig: {
    // 仅服务端可用的配置
    geminiApiKey: process.env.GEMINI_API_KEY || '',

    // 客户端也可用的配置
    public: {
      appName: 'Manju',
      appVersion: '1.0.0',
    },
  },

  // Nitro 服务器配置
  nitro: {
    experimental: {
      asyncContext: true,
    },
  },

  // ESLint 配置
  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs',
      },
    },
  },
})
