import type { SceneData } from '~/lib/asset-workbench-models'
import type {
  AssetImageHistoryEntry,
  EnvironmentAssetCard,
  EnvironmentCropCaptureMode,
  EnvironmentPanoramaState
} from '~/lib/asset-workbench-types'

const SCENE_TIMELINE_PREFIX_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:]/gmu
const MULTI_VIEW_HINT_REGEX = /(多视角|多个视角|多机位|多镜头|多景别|镜头切换|切换镜头|视角切换|镜头切到|切到|转到|angle switch|multi[- ]?angle|multi[- ]?shot)/iu
const SHOT_KEYWORDS = [
  '全景',
  '远景',
  '中景',
  '近景',
  '特写',
  '俯拍',
  '仰拍',
  '主观镜头',
  'pov',
  'over-the-shoulder'
] as const

function countTimelineSegments(text: string): number {
  if (!text) return 0
  return Array.from(text.matchAll(SCENE_TIMELINE_PREFIX_REGEX)).length
}

function countShotKeywordKinds(text: string): number {
  if (!text) return 0

  const normalized = text.toLowerCase()
  let count = 0
  for (const keyword of SHOT_KEYWORDS) {
    const source = keyword.toLowerCase()
    if (normalized.includes(source)) {
      count += 1
    }
  }
  return count
}

export function isSceneLikelyMultiView(
  scene: Pick<SceneData, 'description' | 'cameraNote' | 'environmentCaptureMode'>
): boolean {
  if (scene.environmentCaptureMode === '四视角') return true
  if (scene.environmentCaptureMode === '单视角') return false

  const description = (scene.description || '').trim()
  const cameraNote = (scene.cameraNote || '').trim()
  const text = [description, cameraNote].filter(Boolean).join('\n')
  if (!text) return false

  if (countTimelineSegments(description) >= 2) {
    return true
  }

  if (MULTI_VIEW_HINT_REGEX.test(text)) {
    return true
  }

  return countShotKeywordKinds(description) >= 2
}

export function resolveEnvironmentCaptureModeForScene(
  scene: Pick<SceneData, 'description' | 'cameraNote' | 'environmentCaptureMode'>,
  options: {
    fallbackCaptureMode?: EnvironmentCropCaptureMode
  } = {}
): EnvironmentCropCaptureMode {
  if (isSceneLikelyMultiView(scene)) {
    return '四视角'
  }
  return options.fallbackCaptureMode === '四视角' ? '四视角' : '单视角'
}

type EnvironmentPanoramaReferenceState = Pick<
  EnvironmentPanoramaState,
  'panoramaImage' | 'singleViewImage' | 'fourViewImage' | 'captureMode'
>

type EnvironmentViewImageCard = Pick<
  EnvironmentAssetCard,
  'singleViewImage' | 'fourViewImage' | 'referenceImage' | 'panoramaImage' | 'assetHistory'
>

function normalizeOptionalImage(value?: string | null): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function isSameImage(left?: string, right?: string): boolean {
  return !!left && !!right && left === right
}

function resolveNonPanoramaImage(
  image: string | null | undefined,
  panoramaImage?: string
): string | undefined {
  const normalized = normalizeOptionalImage(image)
  if (!normalized) return undefined
  if (isSameImage(normalized, panoramaImage)) return undefined
  return normalized
}

function resolveHistoryViewImage(
  history: AssetImageHistoryEntry[] | undefined,
  viewMode: EnvironmentCropCaptureMode,
  panoramaImage?: string
): string | undefined {
  if (!Array.isArray(history)) return undefined

  for (const entry of history) {
    if (entry.viewMode !== viewMode) continue
    const image = resolveNonPanoramaImage(entry.image, panoramaImage)
    if (image) return image
  }

  return undefined
}

function resolveLegacySingleViewImage(
  history: AssetImageHistoryEntry[] | undefined,
  panoramaImage?: string
): string | undefined {
  if (panoramaImage || !Array.isArray(history)) return undefined

  for (const entry of history) {
    if (entry.viewMode) continue
    const image = normalizeOptionalImage(entry.image)
    if (image) return image
  }

  return undefined
}

export function resolveEnvironmentViewImageForCard(
  asset: EnvironmentViewImageCard,
  viewMode: EnvironmentCropCaptureMode
): string | undefined {
  const panoramaImage = normalizeOptionalImage(asset.panoramaImage)
  const singleViewImage = resolveNonPanoramaImage(asset.singleViewImage, panoramaImage)
  const fourViewImage = resolveNonPanoramaImage(asset.fourViewImage, panoramaImage)
  const historySingleViewImage = resolveHistoryViewImage(asset.assetHistory, '单视角', panoramaImage)
  const historyFourViewImage = resolveHistoryViewImage(asset.assetHistory, '四视角', panoramaImage)

  if (viewMode === '四视角') {
    return fourViewImage || historyFourViewImage
  }

  const referenceImage = resolveNonPanoramaImage(asset.referenceImage, panoramaImage)
  if (referenceImage && !isSameImage(referenceImage, fourViewImage || historyFourViewImage)) {
    return singleViewImage || historySingleViewImage || referenceImage
  }

  return singleViewImage
    || historySingleViewImage
    || resolveLegacySingleViewImage(asset.assetHistory, panoramaImage)
}

export function resolveEnvironmentReferenceImageByCaptureMode(
  state: EnvironmentPanoramaReferenceState | null | undefined,
  captureMode: EnvironmentCropCaptureMode
): string | undefined {
  if (!state) return undefined

  const singleViewImage = state.singleViewImage?.trim() || ''
  const fourViewImage = state.fourViewImage?.trim() || ''
  const panoramaImage = state.panoramaImage?.trim() || ''

  if (captureMode === '四视角') {
    return fourViewImage || singleViewImage || panoramaImage || undefined
  }

  return singleViewImage || fourViewImage || panoramaImage || undefined
}

export function mergeEnvironmentReferenceViewImages(options: {
  previousSingleViewImage?: string | null
  previousFourViewImage?: string | null
  nextSingleViewImage?: string | null
  nextFourViewImage?: string | null
  captureMode: EnvironmentCropCaptureMode
}): { singleViewImage?: string, fourViewImage?: string } {
  const previousSingleViewImage = normalizeOptionalImage(options.previousSingleViewImage)
  const previousFourViewImage = normalizeOptionalImage(options.previousFourViewImage)
  const nextSingleViewImage = normalizeOptionalImage(options.nextSingleViewImage)
  const nextFourViewImage = normalizeOptionalImage(options.nextFourViewImage)

  if (options.captureMode === '四视角') {
    return {
      // 仅更新四视图；若单视图尚未存在，则首次用本次生成结果补齐。
      singleViewImage: previousSingleViewImage || nextSingleViewImage,
      fourViewImage: nextFourViewImage || previousFourViewImage
    }
  }

  return {
    // 仅更新单视图；若四视图尚未存在，则首次用本次生成结果补齐。
    singleViewImage: nextSingleViewImage || previousSingleViewImage,
    fourViewImage: previousFourViewImage || nextFourViewImage
  }
}

export function resolveEnvironmentReferenceImageForScene(
  scene: Pick<SceneData, 'description' | 'cameraNote' | 'environmentCaptureMode'>,
  state: EnvironmentPanoramaReferenceState | null | undefined
): string | undefined {
  const captureMode = resolveEnvironmentCaptureModeForScene(scene, {
    fallbackCaptureMode: state?.captureMode
  })
  return resolveEnvironmentReferenceImageByCaptureMode(state, captureMode)
}
