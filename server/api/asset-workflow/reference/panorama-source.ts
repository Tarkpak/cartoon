import type {
  WorkflowImageGenerationModelOptions,
  WorkflowPanoramaSourceMode
} from '#shared/types/workflow-models'
import type { ImageModelConfig } from '../../../../shared/types/provider'

const PANORAMA_SOURCE_DEFAULT_IMAGE_SIZE = '2048*1024'
export const PANORAMA_SOURCE_ASPECT_RATIO = '2:1'
const PANORAMA_SOURCE_DEFAULT_MODE: WorkflowPanoramaSourceMode = 'equirectangular_360'

const PANORAMA_SOURCE_MODE_PRESETS: Record<
Exclude<WorkflowPanoramaSourceMode, 'custom'>,
{ label: string, aspectRatio: string, size: string }
> = {
  equirectangular_360: {
    label: '360 等距柱状全景图',
    aspectRatio: '2:1',
    size: '2048*1024'
  },
  equirectangular_180: {
    label: '180 半球等距全景图',
    aspectRatio: '1:1',
    size: '1536*1536'
  },
  cubemap_3x2: {
    label: 'Cubemap 3x2 展开图',
    aspectRatio: '3:2',
    size: '1536*1024'
  },
  cubemap_6x1: {
    label: 'Cubemap 6x1 横向展开图',
    aspectRatio: '6:1',
    size: '3072*512'
  }
}

const PANORAMA_SOURCE_SIZE_BY_ASPECT_RATIO: Record<string, string> = {
  '1:1': '1024*1024',
  '2:1': PANORAMA_SOURCE_DEFAULT_IMAGE_SIZE,
  '2:3': '832*1248',
  '3:2': '1248*832',
  '3:4': '864*1152',
  '4:3': '1152*864',
  '6:1': '3072*512',
  '9:16': '720*1280',
  '16:9': '1280*720',
  '21:9': '1536*640'
}

const PANORAMA_SOURCE_MODES: WorkflowPanoramaSourceMode[] = [
  'equirectangular_360',
  'equirectangular_180',
  'cubemap_3x2',
  'cubemap_6x1',
  'custom'
]

export interface PanoramaSourceProfile {
  mode: WorkflowPanoramaSourceMode
  modeLabel: string
  aspectRatio: string
  size: string
  fallbackApplied: boolean
}

function isPanoramaSourceMode(value?: string): value is WorkflowPanoramaSourceMode {
  return !!value && PANORAMA_SOURCE_MODES.includes(value as WorkflowPanoramaSourceMode)
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

export function normalizeImageSizeValue(value?: string): string | null {
  if (!value) return null
  const normalized = value.replace(/\s+/g, '').toLowerCase().replace('x', '*')
  if (!/^\d+\*\d+$/.test(normalized)) return null

  const [widthRaw = '0', heightRaw = '0'] = normalized.split('*')
  const width = Number(widthRaw)
  const height = Number(heightRaw)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  return `${width}*${height}`
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

function getTargetSourceFromOptions(
  options?: Partial<WorkflowImageGenerationModelOptions> | null
): { mode: WorkflowPanoramaSourceMode, modeLabel: string, aspectRatio: string, size: string } {
  const mode = isPanoramaSourceMode(options?.panoramaSourceMode)
    ? options!.panoramaSourceMode
    : PANORAMA_SOURCE_DEFAULT_MODE

  if (mode === 'custom') {
    const aspectRatio = normalizeAspectRatioValue(options?.panoramaCustomAspectRatio) || PANORAMA_SOURCE_ASPECT_RATIO
    const size = normalizeImageSizeValue(options?.panoramaCustomSize) || resolvePanoramaSourceImageSize(aspectRatio)
    return {
      mode,
      modeLabel: '自定义环境源图',
      aspectRatio,
      size
    }
  }

  const preset = PANORAMA_SOURCE_MODE_PRESETS[mode]
  return {
    mode,
    modeLabel: preset.label,
    aspectRatio: preset.aspectRatio,
    size: preset.size
  }
}

export function modelSupportsPanoramaAspectRatio(
  aspectRatio: string,
  modelConfig?: Pick<ImageModelConfig, 'supportedAspectRatios'> | null
): boolean {
  const normalizedTarget = normalizeAspectRatioValue(aspectRatio)
  if (!normalizedTarget) return false

  const normalizedSupportedAspectRatios = Array.from(new Set(
    (modelConfig?.supportedAspectRatios || [])
      .map(ratio => normalizeAspectRatioValue(ratio))
      .filter((ratio): ratio is string => !!ratio)
  ))

  if (normalizedSupportedAspectRatios.length === 0) return true
  return normalizedSupportedAspectRatios.includes(normalizedTarget)
}

export function resolvePanoramaSourceProfile(
  modelConfig?: Pick<ImageModelConfig, 'supportedAspectRatios'> | null,
  options?: Partial<WorkflowImageGenerationModelOptions> | null
): PanoramaSourceProfile {
  const target = getTargetSourceFromOptions(options)
  const fallbackApplied = !modelSupportsPanoramaAspectRatio(target.aspectRatio, modelConfig)

  return {
    mode: target.mode,
    modeLabel: target.modeLabel,
    aspectRatio: target.aspectRatio,
    size: target.size,
    fallbackApplied
  }
}
