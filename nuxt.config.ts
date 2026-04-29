// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // 模块
  modules: [
    '@nuxt/eslint',
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt',
    'shadcn-nuxt'
  ],

  // 开发工具
  devtools: {
    enabled: true
  },

  // 页面过渡动画
  app: {
    pageTransition: { name: 'page', mode: 'out-in' },
    layoutTransition: { name: 'layout', mode: 'out-in' }
  },

  // CSS
  css: ['~/assets/css/main.css'],

  // 运行时配置
  runtimeConfig: {
    // 仅服务端可用的配置
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    qwenApiKey: process.env.QWEN_API_KEY || '',
    klingAccessKey: process.env.KLING_ACCESS_KEY || '',
    klingSecretKey: process.env.KLING_SECRET_KEY || '',
    klingBaseUrl: process.env.KLING_BASE_URL || 'https://api-beijing.klingai.com',
    volcengineApiKey: process.env.VOLCENGINE_API_KEY || '',

    // 代理配置（国内访问需要）
    httpProxy: process.env.HTTP_PROXY || '',
    httpsProxy: process.env.HTTPS_PROXY || '',

    // 输出目录配置
    outputDir: process.env.OUTPUT_DIR || './output',
    tempDir: process.env.TEMP_DIR || './temp',

    // 视频默认参数
    defaultResolution: process.env.DEFAULT_RESOLUTION || '1080p',
    defaultAspectRatio: process.env.DEFAULT_ASPECT_RATIO || '16:9',
    defaultDuration: parseInt(process.env.DEFAULT_DURATION || '8', 10),

    // 并发控制
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || '3', 10),

    // 日志级别
    logLevel: process.env.LOG_LEVEL || 'info',

    // 成本控制（单位：美元）
    dailyBudgetLimit: parseInt(process.env.DAILY_BUDGET_LIMIT || '50', 10),

    // 客户端也可用的配置
    public: {
      appName: 'playlet',
      appVersion: '1.0.0',
      appBaseUrl: process.env.APP_BASE_URL || ''
    }
  },

  // 路由规则
  routeRules: {
    '/': { prerender: true }
  },

  // Nuxt 4 兼容性设置
  compatibilityDate: '2025-01-15',

  // Nitro 服务器配置
  nitro: {
    experimental: {
      asyncContext: true,
      websocket: true
    },
    // 配置运行时静态资源目录
    publicAssets: [
      {
        dir: 'public/videos',
        baseURL: '/videos'
      }
    ]
  },

  // ESLint 配置
  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  // shadcn-vue 配置
  shadcn: {
    prefix: '',
    componentDir: '@/components/ui'
  }
})
