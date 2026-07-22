import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  normalizeOptionalTimeOfDayCategory,
  normalizeTimeOfDayValue,
  resolveTimeOfDayCategoryText,
  SCRIPT_PARSE_MODES,
  SceneSettingSchema,
  normalizeScriptParseMode
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

describe('script parse modes', () => {
  it('uses premium drama as the only drama workflow', () => {
    expect(DEFAULT_SCRIPT_PARSE_MODE).toBe('premium_drama')
    expect(SCRIPT_PARSE_MODES).toEqual(['premium_drama', 'origin_explainer'])
  })

  it('maps legacy short drama projects to premium drama', () => {
    expect(normalizeScriptParseMode('short_drama')).toBe('premium_drama')
    expect(normalizeScriptParseMode('unknown')).toBe('premium_drama')
  })
})
