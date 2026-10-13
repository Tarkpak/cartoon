import { describe, expect, it } from 'vitest'
import { supportsTextReasoningEffort } from './model-reasoning'

describe('supportsTextReasoningEffort', () => {
  it('recognizes reasoning model families and normalized IDs', () => {
    for (const model of ['gpt-5', 'gpt-5.6-sol', ' models/gpt-6.1-sol ', 'o1', 'o3-mini', 'o4-mini']) {
      expect(supportsTextReasoningEffort(model)).toBe(true)
    }
  })

  it('excludes unsupported models and restricted variants', () => {
    for (const model of ['gpt-4o', 'gpt-50', 'qwen3.6-plus', 'o1-preview', 'o1-mini', 'gpt-5-pro', 'gpt-5-chat-latest']) {
      expect(supportsTextReasoningEffort(model)).toBe(false)
    }
  })
})
