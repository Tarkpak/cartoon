import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const appDir = fileURLToPath(new URL('./app/', import.meta.url))
const sharedDir = fileURLToPath(new URL('./shared/', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^~\//, replacement: appDir },
      { find: /^@\//, replacement: appDir },
      { find: /^#shared\//, replacement: sharedDir }
    ]
  },
  test: {
    environment: 'node'
  }
})
