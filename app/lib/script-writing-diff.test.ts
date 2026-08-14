import { describe, expect, it } from 'vitest'
import { diffScriptWritingLines } from './script-writing-diff'

describe('script writing line diff', () => {
  it('marks inserted and removed lines while preserving shared lines', () => {
    expect(diffScriptWritingLines('开场\n旧对白\n结尾', '开场\n新对白\n结尾')).toEqual([
      { value: '开场\n' },
      { value: '新对白\n', added: true },
      { value: '旧对白\n', removed: true },
      { value: '结尾' }
    ])
  })

  it('handles empty content', () => {
    expect(diffScriptWritingLines('', '新增正文')).toEqual([
      { value: '新增正文', added: true }
    ])
    expect(diffScriptWritingLines('', '')).toEqual([])
  })
})
