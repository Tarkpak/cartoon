import { describe, expect, it } from 'vitest'
import {
  VOLCENGINE_VOICE_PRESETS,
  VOLCENGINE_VOICE_PRESETS_SOURCE
} from './volcengine-voice-presets.generated'

describe('Volcengine official voice presets', () => {
  it('contains the complete compatible 2.0 catalog from the official document', () => {
    expect(VOLCENGINE_VOICE_PRESETS).toHaveLength(444)
    expect(VOLCENGINE_VOICE_PRESETS.filter(voice => voice.model === '2.0')).toHaveLength(293)
    expect(VOLCENGINE_VOICE_PRESETS.filter(voice => voice.model === '2.0-multilingual')).toHaveLength(151)
    expect(VOLCENGINE_VOICE_PRESETS_SOURCE.documentUrl).toContain('/docs/6561/1257544')
  })

  it('keeps every official voice id unique and valid', () => {
    const ids = VOLCENGINE_VOICE_PRESETS.map(voice => voice.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('zh_female_vv_uranus_bigtts')
    expect(ids.some(id => id.startsWith('ICL_uranus_'))).toBe(true)
    expect(ids.every(id => /^[A-Za-z][A-Za-z0-9_-]{7,255}$/.test(id))).toBe(true)
  })
})
