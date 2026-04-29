import type { ImageModelConfig } from '../../../../shared/types/provider'

const PANORAMA_SOURCE_DEFAULT_IMAGE_SIZE = '2048*1024'
export const PANORAMA_SOURCE_ASPECT_RATIO = '2:1'
const PANORAMA_SOURCE_FALLBACK_ASPECT_RATIO = '21:9'

const PANORAMA_SOURCE_SIZE_BY_ASPECT_RATIO: Record<string, string> = {
  '1:1': '1024*1024',
  '2:1': PANORAMA_SOURCE_DEFAULT_IMAGE_SIZE,
  '2:3': '832*1248',
  '3:2': '1248*832',
  '3:4': '864*1152',
  '4:3': '1152*864',
  '9:16': '720*1280',
  '16:9': '1280*720',
  '21:9': '2100*900'
}

export interface PanoramaSourceProfile {
  aspectRatio: string
  size: string
  fallbackApplied: boolean
}

export function normalizeAspectRatioValue(value?: string): string | null {
  if (!value) return null
  const normalized = value.replace(/\s+/g, '')
  if (!/^\d+:\d+$/.test(normalized)) return null

  const [widthRaw = '1', heightRaw = '1'] = normalized.split(':')
  const width = Number(widthRaw)
  const height = Number(heightRaw)

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return `${width}:${height}`
}

export function parseAspectRatioValue(value: string): number | null {
  const normalized = normalizeAspectRatioValue(value)
  if (!normalized) return null

  const [widthRaw = '1', heightRaw = '1'] = normalized.split(':')
  const width = Number(widthRaw)
  const height = Number(heightRaw)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  return width / height
}

export function pickClosestSupportedAspectRatio(
  targetAspectRatio: string,
  supportedAspectRatios: string[]
): string {
  const targetValue = parseAspectRatioValue(targetAspectRatio)
  if (!targetValue) {
    return supportedAspectRatios[0] || targetAspectRatio
  }

  let best = supportedAspectRatios[0] || targetAspectRatio
  let bestDiff = Number.POSITIVE_INFINITY

  for (const ratio of supportedAspectRatios) {
    const ratioValue = parseAspectRatioValue(ratio)
    if (!ratioValue) continue

    const diff = Math.abs(ratioValue - targetValue)
    if (diff < bestDiff) {
      bestDiff = diff
      best = ratio
    }
  }

  return best
}

export function resolvePanoramaSourceImageSize(aspectRatio: string): string {
  return PANORAMA_SOURCE_SIZE_BY_ASPECT_RATIO[aspectRatio]
    || PANORAMA_SOURCE_DEFAULT_IMAGE_SIZE
}

export function resolvePanoramaSourceProfile(
  modelConfig?: Pick<ImageModelConfig, 'supportedAspectRatios'> | null
): PanoramaSourceProfile {
  const fallbackAspectRatio = PANORAMA_SOURCE_ASPECT_RATIO
  const normalizedSupportedAspectRatios = Array.from(new Set(
    (modelConfig?.supportedAspectRatios || [])
      .map(ratio => normalizeAspectRatioValue(ratio))
      .filter((ratio): ratio is string => !!ratio)
  ))

  if (normalizedSupportedAspectRatios.length === 0 || normalizedSupportedAspectRatios.includes(fallbackAspectRatio)) {
    return {
      aspectRatio: fallbackAspectRatio,
      size: resolvePanoramaSourceImageSize(fallbackAspectRatio),
      fallbackApplied: false
    }
  }

  const resolvedAspectRatio = normalizedSupportedAspectRatios.includes(PANORAMA_SOURCE_FALLBACK_ASPECT_RATIO)
    ? PANORAMA_SOURCE_FALLBACK_ASPECT_RATIO
    : pickClosestSupportedAspectRatio(
        fallbackAspectRatio,
        normalizedSupportedAspectRatios
      )

  return {
    aspectRatio: resolvedAspectRatio,
    size: resolvePanoramaSourceImageSize(resolvedAspectRatio),
    fallbackApplied: resolvedAspectRatio !== fallbackAspectRatio
  }
}
