import { describe, expect, it } from 'vitest'
import type { StylePreset } from '#shared/types/styles'
import { filterStylePresets } from './style-preset-settings'

const multiCategoryStyle: StylePreset = {
  id: 'multi-category',
  name: '多分类风格',
  nameEn: 'Multi Category',
  category: 'western',
  categories: ['western', '3d', 'game'],
  description: '用于验证官网多分类筛选',
  prompt: 'multi category'
}

describe('filterStylePresets', () => {
  it('matches every category assigned by the remote style catalog', () => {
    const result = filterStylePresets({
      allStylePresets: [multiCategoryStyle],
      enabledStyleIdSet: new Set([multiCategoryStyle.id]),
      styleCategoryFilter: 'game',
      styleSearchKeyword: ''
    })

    expect(result).toEqual([multiCategoryStyle])
  })
})
