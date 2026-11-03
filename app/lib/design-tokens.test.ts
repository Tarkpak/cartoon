import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_DIR = join(__dirname, '..')

// Categorical palettes (provider badges, settings group colors, prompt categories,
// style decorations) are identities rather than status, so they may use raw hues.
const CATEGORICAL_COLOR_FILES = new Set([
  'components/StyleSelector.vue',
  'components/settings/SettingsStyleOverview.vue',
  'components/settings/SettingsWorkflowSidebar.vue',
  'components/settings/SettingsPromptSidebar.vue',
  'components/settings/SettingsModelTestSidebar.vue',
  'lib/prompt-editor.ts'
])

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return collectSourceFiles(path)
    if (!/\.(vue|ts)$/.test(name) || /\.test\.ts$/.test(name) || name.endsWith('.d.ts')) return []
    return [path]
  })
}

const files = collectSourceFiles(APP_DIR).map(path => ({
  path: relative(APP_DIR, path),
  source: readFileSync(path, 'utf8')
}))

const STATUS_PALETTE = /(?:^|[\s'"`:])(?:bg|text|border|ring|fill|stroke)-(?:red|rose|green|emerald|amber|yellow|orange|blue|sky|cyan|gray|slate|zinc)-\d{2,3}\b/
const ARBITRARY_FONT_SIZE = /\btext-\[\d+(?:\.\d+)?(?:px|rem)\]/

describe('design tokens', () => {
  it('uses semantic color tokens instead of raw status palette colors', () => {
    const offenders = files
      .filter(file => !CATEGORICAL_COLOR_FILES.has(file.path))
      .flatMap(file => file.source.split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => STATUS_PALETTE.test(line))
        .map(({ index }) => `${file.path}:${index + 1}`))
    expect(offenders).toEqual([])
  })

  it('uses the type scale instead of arbitrary font sizes', () => {
    const offenders = files
      .filter(file => ARBITRARY_FONT_SIZE.test(file.source))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })
})
