import type { SceneData } from '~/lib/asset-workbench-models'
import type {
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
  if (scene.environmentCaptureMode === 'four_view') return true
  if (scene.environmentCaptureMode === 'single') return false

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
    return 'four_view'
  }
  return options.fallbackCaptureMode === 'four_view' ? 'four_view' : 'single'
}

type EnvironmentPanoramaReferenceState = Pick<
  EnvironmentPanoramaState,
  'panoramaImage' | 'singleViewImage' | 'fourViewImage' | 'captureMode'
>

export function resolveEnvironmentReferenceImageByCaptureMode(
  state: EnvironmentPanoramaReferenceState | null | undefined,
  captureMode: EnvironmentCropCaptureMode
): string | undefined {
  if (!state) return undefined

  const singleViewImage = state.singleViewImage?.trim() || ''
  const fourViewImage = state.fourViewImage?.trim() || ''
  const panoramaImage = state.panoramaImage?.trim() || ''

  if (captureMode === 'four_view') {
    return fourViewImage || singleViewImage || panoramaImage || undefined
  }

  return singleViewImage || fourViewImage || panoramaImage || undefined
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
