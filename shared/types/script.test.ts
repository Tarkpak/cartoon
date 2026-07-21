import { describe, expect, it } from 'vitest'
import {
  normalizeOptionalTimeOfDayCategory,
  normalizeTimeOfDayValue,
  resolveTimeOfDayCategoryText,
  SceneSettingSchema
} from './script'

describe('open scene time descriptions', () => {
  it('keeps known aliases compatible while preserving specific descriptions', () => {
    expect(normalizeTimeOfDayValue('midnight')).toBe('夜晚')
    expect(normalizeTimeOfDayValue('暴雨前的昏暗午后')).toBe('暴雨前的昏暗午后')
    expect(normalizeOptionalTimeOfDayCategory('暴雨前的昏暗午后')).toBe('下午')
    expect(normalizeTimeOfDayValue('地下空间恒定照明')).toBe('地下空间恒定照明')
    expect(normalizeOptionalTimeOfDayCategory('地下空间恒定照明')).toBeUndefined()
    expect(resolveTimeOfDayCategoryText('深夜')).toBe('夜晚')
    expect(resolveTimeOfDayCategoryText('无月深夜')).toBe('夜晚')
    expect(resolveTimeOfDayCategoryText('地下空间恒定照明')).toBe('地下空间恒定照明')
  })

  it('accepts an open time description in the scene schema', () => {
    const result = SceneSettingSchema.safeParse({
      location: '极地观测站',
      timeOfDay: '极夜，无自然日照'
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.timeOfDay).toBe('极夜，无自然日照')
  })
})
