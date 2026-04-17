import { normalizeProjectVideoUrl } from '#shared/utils/video-url'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import {
  buildSceneEnvironmentConsistencyContext,
  resolveSceneEnvironmentAssetId,
  resolveSceneEnvironmentLabel
} from '~/lib/asset-workbench-environment'
import type { SceneVideoReferenceAsset } from '~/lib/asset-workbench-types'

export type AssetWorkbenchAspectRatio = '16:9' | '9:16' | '1:1'

export interface GenerateSceneBaselineOptions {
  preferReuse?: boolean
  customPrompt?: string
}

export interface AssetWorkflowScenePayload {
  id: string
  title: string
  sceneIndex?: number
  description: string
  cameraNote?: string
  duration: number
  setting?: SceneData['setting']
  narration?: string
  characters: SceneData['characters']
  dialogues: SceneData['dialogues']
}

interface BuildSceneGenerationCameraNoteOptions {
  scene: SceneData
  sceneConfig: SceneConsistencyConfig
  resolveAssetName: (assetId: string) => string
}

interface BuildAssetWorkflowScenePayloadOptions extends BuildSceneGenerationCameraNoteOptions {
  scenes: SceneData[]
  resolveSceneDescriptionWithoutAssetMentions: (raw?: string) => string
}

interface RequestSceneBaselineGenerationOptions {
  scene: SceneData
  scenes: SceneData[]
  scenePayload: AssetWorkflowScenePayload
  style: string
  aspectRatio: AssetWorkbenchAspectRatio
  customPrompt?: string
  referenceImage?: string
}

interface AssetWorkflowVideoReferences {
  environmentImage: string
  characterImage?: string
  characterImages: string[]
  environmentAsset: {
    id: string
    name: string
    type: 'environment'
    image: string
  }
  characterAssets: Array<{
    id: string
    name: string
    type: 'character' | 'prop'
    image: string
  }>
}

interface RequestSceneVideoTaskOptions {
  scenePayload: AssetWorkflowScenePayload
  style: string
  aspectRatio: AssetWorkbenchAspectRatio
  references: AssetWorkflowVideoReferences
}

interface PollSceneVideoTaskOptions {
  maxAttempts?: number
  pollIntervalMs?: number
}

interface VideoTaskStatusResponse {
  success: boolean
  task: {
    status: string
    error?: string
    result?: {
      videoData?: string
    }
  }
}

export function buildSceneGenerationCameraNote(
  options: BuildSceneGenerationCameraNoteOptions
): string | undefined {
  const baseNote = options.scene.cameraNote?.trim() || ''
  const refNames = options.sceneConfig.mustReferenceAssetIds
    .map(options.resolveAssetName)
    .filter(Boolean)
  const continuityNote = options.sceneConfig.continuityNotes.trim()

  const parts = [
    baseNote,
    refNames.length > 0 ? `引用资产：${refNames.join('、')}` : '',
    continuityNote ? `连续性提示：${continuityNote}` : ''
  ].filter(Boolean)

  return parts.length > 0 ? parts.join('\n') : undefined
}

export function buildAssetWorkflowScenePayload(
  options: BuildAssetWorkflowScenePayloadOptions
): AssetWorkflowScenePayload {
  const sceneIndex = options.scenes.findIndex(item => item.id === options.scene.id)

  return {
    id: options.scene.id,
    title: options.scene.title,
    sceneIndex: sceneIndex >= 0 ? sceneIndex + 1 : undefined,
    description: options.resolveSceneDescriptionWithoutAssetMentions(options.scene.description),
    cameraNote: buildSceneGenerationCameraNote(options),
    duration: options.scene.duration,
    setting: options.scene.setting,
    narration: options.scene.narration,
    characters: options.scene.characters,
    dialogues: options.scene.dialogues
  }
}

export function applySceneBaselineReference(scene: SceneData, referenceImage: string) {
  scene.firstFrame = referenceImage
  scene.lastFrame = undefined
  scene.frameStatus = 'done'
  scene.frameError = undefined
  scene.videoUrl = undefined
  scene.videoStatus = 'pending'
  scene.videoError = undefined
}

export function applySceneVideoUrl(scene: SceneData, videoUrl: string) {
  scene.videoUrl = videoUrl
  scene.videoError = undefined
  scene.videoStatus = 'done'
}

export function buildAssetWorkflowVideoReferences(options: {
  scene: SceneData
  environmentImage: string
  characterImages: string[]
  characterAssets: SceneVideoReferenceAsset[]
}): AssetWorkflowVideoReferences {
  return {
    environmentImage: options.environmentImage,
    characterImage: options.characterImages[0],
    characterImages: options.characterImages,
    environmentAsset: {
      id: resolveSceneEnvironmentAssetId(options.scene),
      name: resolveSceneEnvironmentLabel(options.scene),
      type: 'environment',
      image: options.environmentImage
    },
    characterAssets: options.characterAssets.map(item => ({
      id: item.assetId,
      name: item.name,
      type: item.type,
      image: item.image
    }))
  }
}

export async function requestSceneBaselineGeneration(
  options: RequestSceneBaselineGenerationOptions
) {
  const response = await $fetch<{
    success: boolean
    referenceImage?: string
    error?: string
  }>('/api/asset-workflow/reference/generate', {
    method: 'POST',
    body: {
      scene: options.scenePayload,
      style: options.style,
      aspectRatio: options.aspectRatio,
      environmentContext: buildSceneEnvironmentConsistencyContext(options.scene, options.scenes),
      regeneration: options.customPrompt
        ? {
            customPrompt: options.customPrompt,
            referenceImage: options.referenceImage
          }
        : undefined
    }
  })

  if (!response.success || !response.referenceImage) {
    throw new Error(response.error || '环境图生成失败')
  }

  return response.referenceImage
}

export async function requestSceneVideoTask(options: RequestSceneVideoTaskOptions) {
  const response = await $fetch<{
    success: boolean
    taskId?: string
    error?: string
  }>('/api/asset-workflow/video/generate', {
    method: 'POST',
    body: {
      scene: options.scenePayload,
      style: options.style,
      aspectRatio: options.aspectRatio,
      references: options.references
    }
  })

  if (!response.success || !response.taskId) {
    throw new Error(response.error || '视频任务创建失败')
  }

  return response.taskId
}

async function fetchVideoTaskStatus(taskId: string) {
  return await $fetch<VideoTaskStatusResponse>(`/api/video/status/${taskId}`)
}

function wait(duration: number) {
  return new Promise(resolve => setTimeout(resolve, duration))
}

export async function pollSceneVideoTask(
  taskId: string,
  options: PollSceneVideoTaskOptions = {}
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 60
  const pollIntervalMs = options.pollIntervalMs ?? 5000

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await wait(pollIntervalMs)

    const statusResponse = await fetchVideoTaskStatus(taskId)
    if (statusResponse.task.status === 'completed') {
      const normalizedUrl = normalizeProjectVideoUrl(statusResponse.task.result?.videoData) || undefined
      if (!normalizedUrl) {
        throw new Error('视频已生成，但当前返回结果无法直接预览')
      }

      return normalizedUrl
    }

    if (statusResponse.task.status === 'failed') {
      throw new Error(statusResponse.task.error || '视频生成失败')
    }
  }

  throw new Error('视频生成超时，请稍后重试')
}
