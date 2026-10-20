import { describe, expect, it } from 'vitest'
import { buildSubtitleErasureOptions, defaultSubtitleErasureSettings } from './subtitle-erasure-settings'

describe('subtitle erasure options shared by media assistant and scenes', () => {
  it('preserves existing defaults and leaves algorithm-dependent filters unset', () => {
    expect(buildSubtitleErasureOptions(defaultSubtitleErasureSettings())).toEqual({
      mode: 'Subtitle', model_version: 'v4', output_encode_mode: 'Quality'
    })
  })

  it('snapshots selected options including per-segment regions', () => {
    const settings = defaultSubtitleErasureSettings()
    settings.model_version = 'v5.6'
    settings.mode = 'Text'
    settings.output_encode_mode = 'Size'
    settings.time_segment_filter = { mode: 'selected', segments: [{ start_time: 1, end_time: 3, erase_ratio_location: [{ top_left_x: 0, top_left_y: 0, bottom_right_x: 1, bottom_right_y: 0.5 }] }] }
    const options = buildSubtitleErasureOptions(settings)
    settings.time_segment_filter.segments[0]!.end_time = 99
    expect(options.time_segment_filter).toMatchObject({ mode: 'selected', segments: [{ end_time: 3 }] })
    expect(options).toMatchObject({ model_version: 'v5.6', mode: 'Text', output_encode_mode: 'Size' })
    expect(options).not.toHaveProperty('subtitle_filter')
  })

  it('rejects invalid regions, conflicting scopes and invalid times', () => {
    const settings = defaultSubtitleErasureSettings()
    settings.erase_ratio_location = [{ top_left_x: 1, top_left_y: 0.5, bottom_right_x: 0, bottom_right_y: 1 }]
    expect(() => buildSubtitleErasureOptions(settings)).toThrow('擦除框坐标')
    settings.erase_ratio_location[0]!.top_left_x = 0
    settings.erase_ratio_location[0]!.bottom_right_x = 1
    settings.time_segment_filter = { mode: 'selected', segments: [{ start_time: 0, end_time: 3, erase_ratio_location: [...settings.erase_ratio_location] }] }
    expect(() => buildSubtitleErasureOptions(settings)).toThrow('不能与全局')
    settings.erase_ratio_location = []
    settings.time_segment_filter.segments[0]!.end_time = 0
    expect(() => buildSubtitleErasureOptions(settings)).toThrow('结束时间')
  })

  it('omits dormant segment regions when skipping time ranges', () => {
    const settings = defaultSubtitleErasureSettings()
    settings.time_segment_filter = { mode: 'skip', segments: [{ start_time: 0, end_time: 5, erase_ratio_location: [{ top_left_x: 0, top_left_y: 0, bottom_right_x: 1, bottom_right_y: 1 }] }] }
    expect(buildSubtitleErasureOptions(settings).time_segment_filter).toEqual({ mode: 'skip', segments: [{ start_time: 0, end_time: 5 }] })
  })

  it('validates custom filters against version-specific defaults and ignores them in Text mode', () => {
    const settings = defaultSubtitleErasureSettings()
    settings.model_version = 'v5'
    settings.subtitle_filter.min_text_height_ratio = 0.15
    expect(() => buildSubtitleErasureOptions(settings)).toThrow('最小高度')
    settings.subtitle_filter.min_text_height_ratio = 0.02
    expect(buildSubtitleErasureOptions(settings).subtitle_filter).toEqual({ min_text_height_ratio: 0.02 })
    settings.mode = 'Text'
    expect(buildSubtitleErasureOptions(settings)).not.toHaveProperty('subtitle_filter')
  })
})
