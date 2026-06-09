import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

const appDir = fileURLToPath(new URL('./app', import.meta.url))
const sharedDir = fileURLToPath(new URL('./shared', import.meta.url))
const rustBackendUrl = process.env.RUST_BACKEND_URL || 'http://127.0.0.1:43127'
const appVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
).version as string

export default defineConfig({
  define: {
    'import.meta.client': 'true',
    'import.meta.server': 'false',
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [
    vue(),
    AutoImport({
      imports: [
        'vue',
        'vue-router',
        'pinia',
        {
          ofetch: ['$fetch']
        }
      ],
      dirs: ['app/composables'],
      vueTemplate: true,
      dts: 'auto-imports.d.ts'
    }),
    Components({
      dirs: ['app/components'],
      extensions: ['vue'],
      directoryAsNamespace: true,
      collapseSamePrefixes: true,
      globalNamespaces: ['ui'],
      dts: 'components.d.ts'
    })
  ],
  resolve: {
    alias: {
      '@': appDir,
      '~': appDir,
      '#shared': sharedDir
    }
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    watch: {
      ignored: ['**/src-tauri/**', '**/.output/**', '**/data/**']
    },
    proxy: {
      '/api': {
        target: rustBackendUrl,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: '.output/public',
    emptyOutDir: true
  }
})
