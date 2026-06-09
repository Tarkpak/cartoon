interface ImportMeta {
  readonly client: boolean
  readonly server: boolean
}

// 由 vite define 在构建/开发期注入的应用版本号（来自 package.json）
declare const __APP_VERSION__: string
