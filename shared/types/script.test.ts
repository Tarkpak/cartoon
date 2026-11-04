import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  normalizeOptionalTimeOfDayCategory,
  normalizeTimeOfDayValue,
  resolveTimeOfDayCategoryText,
  SCRIPT_PARSE_MODES,
  SceneDurationSchema,
  SceneSettingSchema,
  normalizeScriptParseMode
} from './script'

describe('SceneDurationSchema', () => {
  it('accepts integer seconds and rounds legacy fractional seconds', () => {
    expect(SceneDurationSchema.parse(7)).toBe(7)
    expect(SceneDurationSchema.parse(6.5)).toBe(7)
    expect(SceneDurationSchema.safeParse(3).success).toBe(false)
  })
})

describe('open scene time descriptions', () => {
  it('does not mistake post-midnight darkness for dawn', () => {
    for (const text of ['回溯中的凌晨一点后，摊灯照明', '凌晨1:30', '凌晨四点', '凌晨五点，天还没亮', '凌晨五点，尚未天亮']) {
      expect(resolveTimeOfDayCategoryText(text)).toBe('夜晚')
      expect(normalizeTimeOfDayValue(text)).toBe(text)
    }
    expect(resolveTimeOfDayCategoryText('凌晨五点，晨光照亮街道')).toBe('黎明')
    expect(resolveTimeOfDayCategoryText('凌晨六点')).toBe('凌晨六点')
    expect(resolveTimeOfDayCategoryText('凌晨')).toBe('凌晨')
    expect(resolveTimeOfDayCategoryText('拂晓')).toBe('黎明')
  })

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
