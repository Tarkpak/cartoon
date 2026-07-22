import { describe, expect, it } from 'vitest'
import { normalizeStylePresets } from './styles'

describe('style preset normalization', () => {
  it('maps legacy preset categories into the current website categories', () => {
    const [preset] = normalizeStylePresets([{
      id: 'custom-legacy-style',
      name: '旧分类自建风格',
      nameEn: 'Legacy Custom Style',
      category: 'pixel_game',
      categories: ['pixel_game', 'cute_q'],
      description: '用户在旧版分类下创建的预设',
      prompt: 'legacy custom style'
    }])

    expect(preset.category).toBe('game')
    expect(preset.categories).toEqual(['game', 'chibi'])
  })
})
