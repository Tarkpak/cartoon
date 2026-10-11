import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { loadBuiltinPromptTemplates } from './default-prompt-templates'

describe('builtin admin prompt templates', () => {
  it('loads every registered template from the same assets as the client', async () => {
    const templates = await loadBuiltinPromptTemplates(fileName =>
      readFile(new URL(`../../../src-tauri/assets/default-prompts/${fileName}`, import.meta.url), 'utf8')
    )
    expect(templates.length).toBeGreaterThan(4)
    const storyBible = templates.find(template => template.templateKey === 'script_writing_story_bible')
    const original = await readFile(new URL('../../../src-tauri/assets/default-prompts/script_writing_story_bible.txt', import.meta.url), 'utf8')
    expect(storyBible?.content).toBe(original)
    expect(templates.every(template => template.content.trim().length > 0)).toBe(true)
  })

  it('reports missing builtin content instead of showing a misleading empty editor', async () => {
    await expect(loadBuiltinPromptTemplates(async () => null)).rejects.toThrow('内置提示词缺失')
    await expect(loadBuiltinPromptTemplates(async () => '  ')).rejects.toThrow('内置提示词缺失')
  })
})
