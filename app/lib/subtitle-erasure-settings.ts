export interface ErasureLocation {
  top_left_x: number
  top_left_y: number
  bottom_right_x: number
  bottom_right_y: number
}

export interface ErasureSegment {
  start_time: number
  end_time: number
  erase_ratio_location: ErasureLocation[]
}

export interface SubtitleErasureSettings {
  model_version: 'v4' | 'v5' | 'v5.6'
  mode: 'Subtitle' | 'Text'
  output_encode_mode: 'Quality' | 'Size'
  erase_ratio_location: ErasureLocation[]
  time_segment_filter: { mode: 'all' | 'selected' | 'skip', segments: ErasureSegment[] }
  subtitle_filter: {
    min_text_height_ratio: number | null
    max_text_height_ratio: number | null
    center_offset_ratio: number | null
  }
}

export function defaultSubtitleErasureSettings(): SubtitleErasureSettings {
  return {
    model_version: 'v4', mode: 'Subtitle', output_encode_mode: 'Quality',
    erase_ratio_location: [], time_segment_filter: { mode: 'all', segments: [] },
    subtitle_filter: { min_text_height_ratio: null, max_text_height_ratio: null, center_offset_ratio: null }
  }
}

function ratio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function validateLocations(locations: ErasureLocation[]) {
  if (!Array.isArray(locations) || locations.length > 20) throw new Error('每组擦除区域最多支持 20 个框')
  for (const box of locations) {
    if (!box || ![box.top_left_x, box.top_left_y, box.bottom_right_x, box.bottom_right_y].every(ratio)
      || box.top_left_x >= box.bottom_right_x || box.top_left_y >= box.bottom_right_y) {
      throw new Error('擦除框坐标必须在 0～1 之间，且右下角必须位于左上角的右下方')
    }
  }
}

export function buildSubtitleErasureOptions(settings: SubtitleErasureSettings) {
  if (!['v4', 'v5', 'v5.6'].includes(settings.model_version)
    || !['Subtitle', 'Text'].includes(settings.mode)
    || !['Quality', 'Size'].includes(settings.output_encode_mode)) throw new Error('字幕擦除配置无效，请重新选择')
  validateLocations(settings.erase_ratio_location)
  const options: Record<string, unknown> = {
    model_version: settings.model_version, mode: settings.mode, output_encode_mode: settings.output_encode_mode
  }
  if (settings.erase_ratio_location.length) options.erase_ratio_location = settings.erase_ratio_location
  const filter = settings.time_segment_filter
  if (!['all', 'selected', 'skip'].includes(filter.mode)) throw new Error('擦除时间模式无效')
  if (filter.mode !== 'all') {
    if (!filter.segments.length) throw new Error('请至少添加一个时间段')
    for (const segment of filter.segments) {
      if (!Number.isFinite(segment.start_time) || !Number.isFinite(segment.end_time)
        || segment.start_time < 0 || segment.end_time <= segment.start_time) throw new Error('时间段结束时间必须大于开始时间，开始时间不能小于 0')
      if (filter.mode === 'selected' && segment.erase_ratio_location?.length) {
        validateLocations(segment.erase_ratio_location)
        if (settings.erase_ratio_location.length) throw new Error('分段擦除框仅支持指定时段模式，且不能与全局擦除框同时使用')
      }
    }
    options.time_segment_filter = {
      mode: filter.mode,
      segments: filter.segments.map(segment => ({
        start_time: segment.start_time,
        end_time: segment.end_time,
        ...(filter.mode === 'selected' && segment.erase_ratio_location?.length
          ? { erase_ratio_location: segment.erase_ratio_location } : {})
      }))
    }
  }
  if (settings.mode === 'Subtitle') {
    const subtitleFilter: Record<string, number> = {}
    for (const [key, value] of Object.entries(settings.subtitle_filter)) {
      if (value === null) continue
      if (!ratio(value)) throw new Error('字幕识别比例必须在 0～1 之间')
      subtitleFilter[key] = value
    }
    const min = subtitleFilter.min_text_height_ratio ?? 0.01
    const max = subtitleFilter.max_text_height_ratio ?? (settings.model_version === 'v4' ? 0.2 : 0.1)
    if (min > max) throw new Error('字幕最小高度不能超过最大高度')
    if (Object.keys(subtitleFilter).length) options.subtitle_filter = subtitleFilter
  }
  // Snapshot the options so edits during uploads cannot change an in-flight batch.
  return JSON.parse(JSON.stringify(options)) as Record<string, unknown>
}
