export default [
  {
    ignores: [
      '.nuxt/**',
      '.output/**',
      'node_modules/**',
      'src-tauri/target/**',
      'dist/**'
    ]
  },
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {}
  }
]
