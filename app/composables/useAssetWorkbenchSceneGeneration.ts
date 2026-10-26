import { resolveSceneVoiceReferenceSummary } from '~/lib/asset-workbench-voice'
import type { ComputedRef, Ref } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import {
  applySceneBaselineReference,
  applySceneVideoUrl,
  buildAssetWorkflowScenePayload as createAssetWorkflowScenePayload,
  buildAssetWorkflowVideoReferences,
  isRetryableVideoImageDownloadError,
  pollSceneVideoTask,
  requestSceneBaselineGeneration,
  requestSceneVideoTask,
  type GenerateSceneBaselineOptions
} from '~/lib/asset-workbench-scene-generation'
import {
  invalidateSceneGenerationState,
  invalidateSceneVideoState
} from '~/lib/asset-workbench-scenes'
import type {
  EnvironmentCropCaptureMode,
  QueueItem,
  EnvironmentCropSelection,
  EnvironmentPanoramaState
} from '~/lib/asset-workbench-types'
import type { ScriptParseMode } from '#shared/types/script'
import { DEFAULT_SCRIPT_PARSE_MODE } from '#shared/types/script'
import { uniqueSorted } from '~/lib/asset-workbench-strings'
import {
  findReusableEnvironmentImage,
  resolveSceneEnvironmentAssetId,
  resolveSceneEnvironmentLabel,
  resolveSceneReferenceImage
} from '~/lib/asset-workbench-environment'
import {
  resolveConfiguredCharacterReferences,
  resolveSceneNarrationVoiceAsset,
  resolveSceneVideoCharacterReferences,
  resolveSceneVideoReferenceAssets
} from '~/lib/asset-workbench-scene-references'
import {
  resolveEnvironmentCaptureModeForScene,
  resolveEnvironmentReferenceImageByCaptureMode
} from '~/lib/asset-workbench-environment-views'
import {
  fetchActiveSceneVideoTasks,
  isVideoTaskStatusUnavailableError
} from '~/lib/asset-workbench-video-tasks'

const ENVIRONMENT_REFERENCE_ASPECT_RATIO = '16:9' as const
const VIDEO_RESULT_SAVE_ATTEMPTS = 3
const VIDEO_RESULT_SAVE_RETRY_DELAY_MS = 500
/** 批量生成时同时进行的分镜视频任务数；供应商侧任务本身是异步的，不必逐个等待 */
const MAX_CONCURRENT_SCENE_VIDEO_TASKS = 3

interface TrackedSceneVideoTask {
  taskId: string
  /** 创建任务时的输入快照；刷新页面后恢复的任务没有快照 */
  generationKey?: string
}

interface SceneVideoInputs {
  characterReferenceAssets: ReturnType<typeof resolveSceneVideoReferenceAssets>
  characterImages: string[]
  narrationVoiceReference: ReturnType<typeof resolveSceneNarrationVoiceAsset>
  continuityFirstFrame: string | undefined
}

interface SceneVideoRunOptions {
  skipCompletionNotice?: boolean
}

/** 同一个 key 同时只跑一份，后来者直接等待已在进行的那份 */
function runOnce<T>(registry: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const existing = registry.get(key)
  if (existing) return existing

  const run = start()
  registry.set(key, run)
  const cleanup = () => {
    if (registry.get(key) === run) registry.delete(key)
  }
  void run.then(cleanup, cleanup)
  return run
}

interface UseAssetWorkbenchSceneGenerationOptions {
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  sceneConfigs: Ref<Record<string, SceneConsistencyConfig>>
  propAssets: Ref<PropAsset[]>
  queueItems: Ref<QueueItem[]>
  batchRunning: Ref<boolean>
  workflowStylePrompt: ComputedRef<string>
  projectId?: ComputedRef<string | undefined>
  projectAspectRatio: Ref<'16:9' | '9:16' | '1:1'>
  scriptParseMode?: Ref<ScriptParseMode>
  normalizeWorkflowText: (value: string) => string
  resolveUiError: (error: unknown, fallback: string) => string
  ensureSceneConfig: (sceneId: string) => SceneConsistencyConfig
  resolveAssetName: (assetId: string) => string
  resolveSceneDescriptionWithoutAssetMentions: (raw?: string) => string
  synchronizeQueueItems: () => void
  saveProject: () => Promise<unknown>
  refreshCharacterVoiceAssets?: (options?: { attempts?: number, delayMs?: number }) => Promise<void>
  generateCharacter: (
    character: CharacterData,
    options?: {
      regenerationPrompt?: string
      referenceImage?: string
      skipCompletionNotice?: boolean
    }
  ) => Promise<unknown>
  batchGenerateCharacters: (
    onProgress?: (current: number, total: number, name: string) => void
  ) => Promise<unknown>
  persistAutomaticAssetPlan: (
    options?: { overwriteExistingConfigs?: boolean }
  ) => Promise<unknown>
  recordEnvironmentHistory?: (
    assetId: string,
    image: string,
    options?: {
      source?: 'generated' | 'legacy'
      prompt?: string
      viewMode?: EnvironmentCropCaptureMode
    }
  ) => void
  resolveEnvironmentPanoramaState?: (assetId: string) => EnvironmentPanoramaState | undefined
  setEnvironmentPanoramaState?: (
    assetId: string,
    state: EnvironmentPanoramaState | undefined
  ) => void
  createEnvironmentCropImage?: (options: {
    assetId: string
    sourceImage: string
    crop?: EnvironmentCropSelection
    captureMode?: EnvironmentCropCaptureMode
    aspectRatio?: string
  }) => Promise<{
    imageUrl: string
    crop: EnvironmentCropSelection
    captureMode: EnvironmentCropCaptureMode
    singleViewImage?: string
    fourViewImage?: string
  }>
  resolveSceneBaselineReferenceImage?: (scene: SceneData) => string | undefined
  recordSceneVideoHistory?: (
    sceneId: string,
    videoUrl: string,
    options?: {
      source?: 'generated' | 'legacy'
      prompt?: string
    }
  ) => void
  onModelTaskCompleted?: (payload: {
    title: string
    body?: string
  }) => Promise<unknown> | unknown
  onModelTaskFailed?: (payload: {
    title: string
    body?: string
  }) => Promise<unknown> | unknown
}

export function useAssetWorkbenchSceneGeneration(
  options: UseAssetWorkbenchSceneGenerationOptions
) {
  const pendingBaselineGenerationKeys = new Map<string, string>()
  const pendingVideoGenerationKeys = new Map<string, string>()
  const trackedVideoTasks = new Map<string, TrackedSceneVideoTask>()
  const sceneVideoRuns = new Map<string, Promise<void>>()
  const environmentBaselineRuns = new Map<string, Promise<void>>()
  const characterGenerationRuns = new Map<string, Promise<unknown>>()

  async function notifyModelTaskCompleted(payload: {
    title: string
    body?: string
  }) {
    if (!options.onModelTaskCompleted) return
    try {
      await options.onModelTaskCompleted(payload)
    } catch (error) {
      console.warn('[useAssetWorkbenchSceneGeneration] 模型任务完成通知失败:', error)
    }
  }

  async function notifyModelTaskFailed(payload: {
    title: string
    body?: string
  }) {
    if (!options.onModelTaskFailed) return
    try {
      await options.onModelTaskFailed(payload)
    } catch (error) {
      console.warn('[useAssetWorkbenchSceneGeneration] 模型任务失败通知失败:', error)
    }
  }

  function resolveSceneEnvironmentReferenceAssetId(scene: SceneData): string {
    const configuredAssetId = options.sceneConfigs.value[scene.id]?.environmentAssetId?.trim() || ''
    return configuredAssetId || resolveSceneEnvironmentAssetId(scene)
  }

  function resolveSceneAvailableReferenceImage(scene: SceneData): string | undefined {
    return options.resolveSceneBaselineReferenceImage?.(scene)?.trim()
      || resolveSceneReferenceImage(scene)
      || scene.firstFrame
  }

  async function applySceneReferenceIfAvailable(scene: SceneData): Promise<boolean> {
    if (resolveSceneReferenceImage(scene)) return false

    const reusableImage = resolveSceneAvailableReferenceImage(scene)
    if (!reusableImage) return false

    applySceneBaselineReference(scene, reusableImage)
    const environmentAssetId = resolveSceneEnvironmentReferenceAssetId(scene)
    options.recordEnvironmentHistory?.(
      environmentAssetId,
      reusableImage,
      { source: 'legacy' }
    )
    options.synchronizeQueueItems()
    await options.saveProject()
    return true
  }

  async function saveGeneratedVideoToProject(): Promise<void> {
    for (let attempt = 0; attempt < VIDEO_RESULT_SAVE_ATTEMPTS; attempt += 1) {
      const saved = await options.saveProject()
      if (saved !== false) return

      if (attempt < VIDEO_RESULT_SAVE_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, VIDEO_RESULT_SAVE_RETRY_DELAY_MS))
      }
    }

    throw new Error('视频已生成，但同步到项目失败，请稍后重试保存')
  }

  async function ensureSceneReferencedAssetsReady(scene: SceneData): Promise<void> {
    const config = options.ensureSceneConfig(scene.id)

    const referencedCharacters = resolveConfiguredCharacterReferences({
      scene,
      characters: options.characters.value,
      propAssets: options.propAssets.value,
      sceneConfigs: options.sceneConfigs.value
    })
    for (const character of referencedCharacters) {
      if (character.baseImage?.trim()) continue

      try {
        await runOnce(characterGenerationRuns, character.id, () => options.generateCharacter(character, {
          skipCompletionNotice: true
        }))
      } catch (error) {
        const message = options.resolveUiError(error, `${character.name} 角色图生成失败`)
        throw new Error(`引用角色资产未就绪：${message}`)
      }

      if (!character.baseImage?.trim()) {
        throw new Error(`引用角色资产未就绪：${character.name}`)
      }
    }

    const referencedEnvironmentIds = uniqueSorted(
      config.mustReferenceAssetIds.filter(assetId => assetId.startsWith('env:'))
    )

    for (const environmentId of referencedEnvironmentIds) {
      const relatedScenes = options.scenes.value.filter(item => resolveSceneEnvironmentReferenceAssetId(item) === environmentId)
      if (relatedScenes.length === 0) continue

      const readyScene = relatedScenes.find((item) => {
        return !!resolveSceneAvailableReferenceImage(item)
      })
      if (readyScene) continue

      const fallbackScene = relatedScenes.find((item) => {
        return item.referenceStatus !== 'generating' && item.videoStatus !== 'generating'
      }) || relatedScenes[0]
      if (!fallbackScene) continue

      await ensureSceneEnvironmentReady(fallbackScene)

      if (fallbackScene.referenceStatus === 'error') {
        throw new Error(
          options.normalizeWorkflowText(
            fallbackScene.referenceError || `引用环境「${resolveSceneEnvironmentLabel(fallbackScene)}」生成失败`
          )
        )
      }

      if (!resolveSceneAvailableReferenceImage(fallbackScene)) {
        throw new Error(`引用环境资产未就绪：${resolveSceneEnvironmentLabel(fallbackScene)}`)
      }
    }

    // 兼容旧数据：仍识别 scene:* 引用
    const referencedSceneIds = uniqueSorted(
      config.mustReferenceAssetIds
        .filter(assetId => assetId.startsWith('scene:'))
        .map(assetId => assetId.slice('scene:'.length))
        .filter(sceneId => !!sceneId && sceneId !== scene.id)
    )

    for (const referencedSceneId of referencedSceneIds) {
      const referencedScene = options.scenes.value.find(item => item.id === referencedSceneId)
      if (!referencedScene) continue

      const referenceImage = resolveSceneAvailableReferenceImage(referencedScene)
      if (referenceImage) continue

      await ensureSceneEnvironmentReady(referencedScene)

      if (referencedScene.referenceStatus === 'error') {
        throw new Error(
          options.normalizeWorkflowText(
            referencedScene.referenceError || `引用场景「${referencedScene.title}」环境图生成失败`
          )
        )
      }

      if (!resolveSceneAvailableReferenceImage(referencedScene)) {
        throw new Error(`引用环境资产未就绪：${referencedScene.title}`)
      }
    }
  }

  /**
   * 确保场景环境图就绪。共用同一环境资产的场景并发生成时，只生成一次，
   * 其余场景等它完成后直接复用。
   */
  async function ensureSceneEnvironmentReady(scene: SceneData): Promise<void> {
    const environmentAssetId = resolveSceneEnvironmentReferenceAssetId(scene)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (resolveSceneAvailableReferenceImage(scene)) return

      const inflight = environmentBaselineRuns.get(environmentAssetId)
      if (inflight) {
        await inflight.catch(() => undefined)
        continue
      }

      await runOnce(environmentBaselineRuns, environmentAssetId, () => generateSceneBaseline(scene.id, {
        preferReuse: true,
        skipCompletionNotice: true
      }))
      return
    }
  }

  function buildAssetWorkflowScenePayload(
    scene: SceneData,
    payloadOptions: { referenceAssetNames?: string[] } = {}
  ) {
    return createAssetWorkflowScenePayload({
      scene,
      scenes: options.scenes.value,
      sceneConfig: options.ensureSceneConfig(scene.id),
      resolveAssetName: options.resolveAssetName,
      referenceAssetNames: payloadOptions.referenceAssetNames,
      resolveSceneDescriptionWithoutAssetMentions: options.resolveSceneDescriptionWithoutAssetMentions,
      characterLanguages: scene.characters.map((sceneCharacter) => {
        const character = options.characters.value.find(item => item.id === sceneCharacter.assetId?.replace(/^char:/, '') || item.name === sceneCharacter.name)
        if (!character) return null
        const labels: Record<string, string> = { mandarin: '普通话', chongqing: '重庆方言', dongbei: '东北话', cantonese: '粤语', sichuan: '四川话', wu: '吴语', english: '英语', japanese: '日语', custom: character.languageNote || '自定义语言' }
        return { name: character.name, language: labels[character.language || 'mandarin'] || '普通话', note: character.languageNote }
      }).filter((item): item is { name: string, language: string, note: string | undefined } => !!item)
    })
  }

  function buildVideoReferenceAssetNames(
    characterReferenceAssets: ReturnType<typeof resolveSceneVideoReferenceAssets>,
    narrationVoiceReference?: ReturnType<typeof resolveSceneNarrationVoiceAsset>
  ): string[] {
    const names = characterReferenceAssets.map(asset => asset.name)
    if (narrationVoiceReference?.audioUrl?.trim()) {
      names.push(narrationVoiceReference.name)
    }
    return uniqueSorted(names.map(name => name.trim()).filter(Boolean))
  }

  function buildSceneBaselineGenerationKey(
    scene: SceneData,
    generationOptions: GenerateSceneBaselineOptions = {}
  ): string {
    const referenceInputs = resolveSceneBaselineReferenceInputs(scene, generationOptions)

    return JSON.stringify({
      scenePayload: buildAssetWorkflowScenePayload(scene),
      style: options.workflowStylePrompt.value,
      aspectRatio: ENVIRONMENT_REFERENCE_ASPECT_RATIO,
      customPrompt: generationOptions.customPrompt?.trim() || '',
      referenceImage: referenceInputs.referenceImage || '',
      consistencyReferenceImage: referenceInputs.consistencyReferenceImage || ''
    })
  }

  function resolveSceneBaselineReferenceInputs(
    scene: SceneData,
    generationOptions: GenerateSceneBaselineOptions = {}
  ): {
    referenceImage?: string
    consistencyReferenceImage?: string
    consistencyReferenceImages?: string[]
  } {
    const customPrompt = generationOptions.customPrompt?.trim() || ''
    const consistencyReferenceImage = generationOptions.consistencyReferenceImage?.trim() || ''
    const consistencyReferenceImages = Array.isArray(generationOptions.consistencyReferenceImages)
      ? Array.from(new Set(
          generationOptions.consistencyReferenceImages
            .map(value => value?.trim() || '')
            .filter(Boolean)
        ))
      : []
    const sceneReferenceImage = options.resolveSceneBaselineReferenceImage?.(scene)?.trim()
      || resolveSceneReferenceImage(scene)
      || scene.firstFrame?.trim()
      || undefined

    if (customPrompt) {
      return {
        referenceImage: sceneReferenceImage,
        consistencyReferenceImage: consistencyReferenceImage || undefined,
        consistencyReferenceImages: consistencyReferenceImages.length > 0
          ? consistencyReferenceImages
          : undefined
      }
    }

    if (!consistencyReferenceImage) {
      return {
        consistencyReferenceImages: consistencyReferenceImages.length > 0
          ? consistencyReferenceImages
          : undefined
      }
    }

    return {
      consistencyReferenceImage,
      consistencyReferenceImages: consistencyReferenceImages.length > 0
        ? consistencyReferenceImages
        : undefined
    }
  }

  function buildSceneVideoGenerationKey(
    scene: SceneData,
    environmentImage: string,
    inputs: SceneVideoInputs
  ): string {
    const {
      characterReferenceAssets,
      characterImages,
      narrationVoiceReference,
      continuityFirstFrame
    } = inputs
    const referenceAssetNames = buildVideoReferenceAssetNames(
      characterReferenceAssets,
      narrationVoiceReference
    )
    return JSON.stringify({
      scenePayload: buildAssetWorkflowScenePayload(scene, { referenceAssetNames }),
      style: options.workflowStylePrompt.value,
      aspectRatio: options.projectAspectRatio.value,
      environmentImage,
      continuityFirstFrame: continuityFirstFrame || '',
      narrationVoiceAsset: narrationVoiceReference
        ? {
            assetId: narrationVoiceReference.assetId,
            audioUrl: narrationVoiceReference.audioUrl,
            source: narrationVoiceReference.source,
            locked: narrationVoiceReference.locked
          }
        : null,
      characterVoiceAssets: resolveSceneVoiceReferenceSummary({
        scene,
        characters: options.characters.value
      }).characters,
      characterImages,
      characterAssets: characterReferenceAssets.map(asset => ({
        assetId: asset.assetId,
        name: asset.name,
        type: asset.type,
        image: asset.image,
        arkAssetId: asset.arkAssetId,
        arkAssetStatus: asset.arkAssetStatus,
        source: asset.source
      }))
    })
  }

  /** 开启「上一镜尾帧作为首帧」时，返回提供尾帧的上一个场景 */
  function resolveContinuitySourceScene(scene: SceneData): SceneData | undefined {
    const config = options.sceneConfigs.value[scene.id]
    if (config?.usePreviousLastFrameAsFirstFrame !== true) return undefined

    const sceneIndex = options.scenes.value.findIndex(item => item.id === scene.id)
    if (sceneIndex <= 0) return undefined

    const previous = options.scenes.value[sceneIndex - 1]
    if (!previous) return undefined

    const currentEpisodeId = scene.episodeId?.trim() || ''
    const previousEpisodeId = previous.episodeId?.trim() || ''
    if (currentEpisodeId && previousEpisodeId && currentEpisodeId !== previousEpisodeId) {
      return undefined
    }

    return previous
  }

  function resolvePreviousSceneLastFrameForContinuity(scene: SceneData): string | undefined {
    return resolveContinuitySourceScene(scene)?.lastFrame?.trim() || undefined
  }

  function resolveSceneVideoInputs(scene: SceneData): SceneVideoInputs {
    const referenceOptions = {
      scene,
      characters: options.characters.value,
      propAssets: options.propAssets.value,
      sceneConfigs: options.sceneConfigs.value
    }
    return {
      characterReferenceAssets: resolveSceneVideoReferenceAssets(referenceOptions),
      characterImages: resolveSceneVideoCharacterReferences(referenceOptions),
      narrationVoiceReference: resolveSceneNarrationVoiceAsset(referenceOptions),
      continuityFirstFrame: resolvePreviousSceneLastFrameForContinuity(scene)
    }
  }

  function invalidateNextSceneVideoForContinuity(scene: SceneData): boolean {
    const sceneIndex = options.scenes.value.findIndex(item => item.id === scene.id)
    if (sceneIndex < 0) return false

    const nextScene = options.scenes.value[sceneIndex + 1]
    if (!nextScene) return false
    const nextConfig = options.sceneConfigs.value[nextScene.id]
    if (nextConfig?.usePreviousLastFrameAsFirstFrame !== true) return false

    const currentEpisodeId = scene.episodeId?.trim() || ''
    const nextEpisodeId = nextScene.episodeId?.trim() || ''
    if (currentEpisodeId && nextEpisodeId && currentEpisodeId !== nextEpisodeId) {
      return false
    }

    return invalidateSceneVideoState(nextScene)
  }

  async function generateSceneBaseline(
    sceneId: string,
    generationOptions: GenerateSceneBaselineOptions & {
      skipCompletionNotice?: boolean
    } = {}
  ) {
    const scene = options.scenes.value.find(item => item.id === sceneId)
    if (!scene) return
    if (scene.referenceStatus === 'generating' || scene.videoStatus === 'generating') return

    const customPrompt = generationOptions.customPrompt?.trim()

    if (generationOptions.preferReuse && !customPrompt) {
      const appliedFromAsset = await applySceneReferenceIfAvailable(scene)
      if (appliedFromAsset) {
        return
      }

      const reusableImage = findReusableEnvironmentImage(scene, options.scenes.value)
      if (reusableImage) {
        applySceneBaselineReference(scene, reusableImage)
        const environmentAssetId = resolveSceneEnvironmentReferenceAssetId(scene)
        options.recordEnvironmentHistory?.(
          environmentAssetId,
          reusableImage,
          { source: 'legacy' }
        )
        options.synchronizeQueueItems()
        await options.saveProject()
        return
      }
    }

    const generationKey = buildSceneBaselineGenerationKey(scene, generationOptions)
    pendingBaselineGenerationKeys.set(scene.id, generationKey)

    scene.referenceStatus = 'generating'
    scene.referenceError = undefined

    try {
      const referenceInputs = resolveSceneBaselineReferenceInputs(scene, generationOptions)
      const panoramaImage = await requestSceneBaselineGeneration({
        projectId: options.projectId?.value,
        scene,
        scenes: options.scenes.value,
        scenePayload: buildAssetWorkflowScenePayload(scene),
        style: options.workflowStylePrompt.value,
        aspectRatio: ENVIRONMENT_REFERENCE_ASPECT_RATIO,
        customPrompt,
        referenceImage: referenceInputs.referenceImage,
        consistencyReferenceImage: referenceInputs.consistencyReferenceImage,
        consistencyReferenceImages: referenceInputs.consistencyReferenceImages
      })

      const latestGenerationKey = pendingBaselineGenerationKeys.get(scene.id)
      const currentGenerationKey = buildSceneBaselineGenerationKey(scene, generationOptions)
      if (latestGenerationKey !== generationKey || currentGenerationKey !== generationKey) {
        const invalidated = invalidateSceneGenerationState(scene)
        if (invalidated) {
          options.synchronizeQueueItems()
          await options.saveProject()
        }
        return
      }

      const environmentAssetId = resolveSceneEnvironmentReferenceAssetId(scene)
      const existingPanoramaState = options.resolveEnvironmentPanoramaState?.(environmentAssetId)
      let referenceImage = panoramaImage
      let crop = existingPanoramaState?.panoramaImage === panoramaImage
        ? existingPanoramaState?.crop
        : undefined
      let captureMode = existingPanoramaState?.captureMode
      let singleViewImage = existingPanoramaState?.panoramaImage === panoramaImage
        ? existingPanoramaState?.singleViewImage
        : undefined
      let fourViewImage = existingPanoramaState?.panoramaImage === panoramaImage
        ? existingPanoramaState?.fourViewImage
        : undefined

      if (options.createEnvironmentCropImage) {
        try {
          const cropOptions: {
            assetId: string
            sourceImage: string
            crop?: EnvironmentCropSelection
            captureMode?: EnvironmentCropCaptureMode
            aspectRatio?: string
          } = {
            assetId: environmentAssetId,
            sourceImage: panoramaImage,
            crop,
            aspectRatio: ENVIRONMENT_REFERENCE_ASPECT_RATIO
          }
          if (captureMode) {
            cropOptions.captureMode = captureMode
          }
          const croppedResult = await options.createEnvironmentCropImage({
            ...cropOptions
          })
          crop = croppedResult.crop
          captureMode = croppedResult.captureMode
          const normalizedSingleViewImage = croppedResult.singleViewImage?.trim()
            || (croppedResult.captureMode === '单视角'
              ? croppedResult.imageUrl?.trim()
              : undefined)
          const normalizedFourViewImage = croppedResult.fourViewImage?.trim()
            || (croppedResult.captureMode === '四视角'
              ? croppedResult.imageUrl?.trim()
              : undefined)
          singleViewImage = normalizedSingleViewImage || singleViewImage
          fourViewImage = normalizedFourViewImage || fourViewImage
        } catch (error) {
          console.warn('[AssetWorkbench] 环境全景图裁切失败，已回退使用原始环境图', {
            sceneId: scene.id,
            environmentAssetId,
            reason: error instanceof Error ? error.message : String(error)
          })
        }
      }

      const resolvedCaptureMode = resolveEnvironmentCaptureModeForScene(scene, {
        fallbackCaptureMode: captureMode
      })
      referenceImage = resolveEnvironmentReferenceImageByCaptureMode({
        panoramaImage,
        singleViewImage,
        fourViewImage,
        captureMode
      }, resolvedCaptureMode) || panoramaImage

      applySceneBaselineReference(scene, referenceImage)
      const panoramaState: EnvironmentPanoramaState = {
        panoramaImage,
        crop
      }
      if (captureMode === '四视角') {
        panoramaState.captureMode = '四视角'
      }
      if (singleViewImage?.trim()) {
        panoramaState.singleViewImage = singleViewImage
      }
      if (fourViewImage?.trim()) {
        panoramaState.fourViewImage = fourViewImage
      }
      options.setEnvironmentPanoramaState?.(environmentAssetId, panoramaState)
      const normalizedSingleViewImage = singleViewImage?.trim()
      const normalizedFourViewImage = fourViewImage?.trim()

      if (normalizedSingleViewImage) {
        options.recordEnvironmentHistory?.(
          environmentAssetId,
          normalizedSingleViewImage,
          {
            source: 'generated',
            prompt: customPrompt,
            viewMode: '单视角'
          }
        )
      }
      if (normalizedFourViewImage) {
        options.recordEnvironmentHistory?.(
          environmentAssetId,
          normalizedFourViewImage,
          {
            source: 'generated',
            prompt: customPrompt,
            viewMode: '四视角'
          }
        )
      }
      if (!normalizedSingleViewImage && !normalizedFourViewImage) {
        options.recordEnvironmentHistory?.(
          environmentAssetId,
          referenceImage,
          {
            source: 'generated',
            prompt: customPrompt
          }
        )
      }
      options.synchronizeQueueItems()
      await options.saveProject()
      if (!generationOptions.skipCompletionNotice) {
        await notifyModelTaskCompleted({
          title: customPrompt ? '环境图二次生成完成' : '环境图生成完成',
          body: `场景：${scene.title}`
        })
      }
    } catch (error) {
      scene.referenceStatus = 'error'
      scene.referenceError = options.resolveUiError(error, '环境图生成失败')
      if (!generationOptions.skipCompletionNotice) {
        await notifyModelTaskFailed({
          title: customPrompt ? '环境图二次生成失败' : '环境图生成失败',
          body: `场景：${scene.title}（${scene.referenceError}）`
        })
      }
      throw new Error(scene.referenceError)
    } finally {
      if (pendingBaselineGenerationKeys.get(scene.id) === generationKey) {
        pendingBaselineGenerationKeys.delete(scene.id)
      }
    }
  }

  /** 轮询已提交的任务；只有任务确定结束时才停止跟踪，查询暂时失败则保留以便重试时继续等待 */
  async function pollTrackedSceneVideoTask(sceneId: string, taskId: string) {
    const stopTracking = () => {
      if (trackedVideoTasks.get(sceneId)?.taskId === taskId) {
        trackedVideoTasks.delete(sceneId)
      }
    }
    try {
      const result = await pollSceneVideoTask(taskId)
      stopTracking()
      return result
    } catch (error) {
      if (!isVideoTaskStatusUnavailableError(error)) stopTracking()
      throw error
    }
  }

  async function applyGeneratedSceneVideo(
    scene: SceneData,
    videoResult: { videoUrl: string, lastFrame?: string },
    runOptions: SceneVideoRunOptions
  ) {
    applySceneVideoUrl(scene, videoResult.videoUrl)
    if (videoResult.lastFrame) {
      scene.lastFrame = videoResult.lastFrame
      if (invalidateNextSceneVideoForContinuity(scene)) {
        options.synchronizeQueueItems()
      }
    }
    options.recordSceneVideoHistory?.(scene.id, videoResult.videoUrl, {
      source: 'generated'
    })
    await saveGeneratedVideoToProject()
    if (!runOptions.skipCompletionNotice) {
      await notifyModelTaskCompleted({
        title: '分镜视频生成完成',
        body: `场景：${scene.title}`
      })
    }
    void options.refreshCharacterVoiceAssets?.({
      attempts: 45,
      delayMs: 2000
    })
  }

  /** 生成期间场景被修改：结果不再匹配当前场景，但已付费生成，存入历史版本供用户取用 */
  async function keepOutdatedSceneVideoResult(scene: SceneData, videoUrl: string) {
    options.recordSceneVideoHistory?.(scene.id, videoUrl, {
      source: 'generated'
    })
    invalidateSceneVideoState(scene)
    options.synchronizeQueueItems()
    await options.saveProject()
    await notifyModelTaskFailed({
      title: '分镜视频结果未采用',
      body: `场景：${scene.title} 在生成期间被修改，本次视频已存入历史版本，请重新生成`
    })
  }

  async function markSceneVideoFailed(
    scene: SceneData,
    error: unknown,
    runOptions: SceneVideoRunOptions
  ): Promise<never> {
    scene.videoStatus = 'error'
    scene.videoError = options.resolveUiError(error, '视频生成失败')
    if (!runOptions.skipCompletionNotice) {
      await notifyModelTaskFailed({
        title: '分镜视频生成失败',
        body: `场景：${scene.title}（${scene.videoError}）`
      })
    }
    throw new Error(scene.videoError)
  }

  async function runSceneVideoGeneration(scene: SceneData, runOptions: SceneVideoRunOptions) {
    let generationKey: string | undefined

    try {
      await ensureSceneReferencedAssetsReady(scene)
      await ensureSceneEnvironmentReady(scene)
      if (scene.referenceStatus === 'error') {
        throw new Error(options.normalizeWorkflowText(scene.referenceError || '场景环境图生成失败'))
      }

      const environmentImage = resolveSceneAvailableReferenceImage(scene)
      if (!environmentImage) {
        throw new Error('场景环境图未就绪，无法生成视频')
      }

      if (resolveSceneReferenceImage(scene) !== environmentImage) {
        applySceneBaselineReference(scene, environmentImage)
      }

      const inputs = resolveSceneVideoInputs(scene)
      const referenceAssetNames = buildVideoReferenceAssetNames(
        inputs.characterReferenceAssets,
        inputs.narrationVoiceReference
      )
      const currentKey = buildSceneVideoGenerationKey(scene, environmentImage, inputs)
      generationKey = currentKey
      pendingVideoGenerationKeys.set(scene.id, currentKey)

      scene.videoStatus = 'generating'
      scene.videoError = undefined

      const narrationVoiceReference = inputs.narrationVoiceReference
      const videoTaskOptions = {
        projectId: options.projectId?.value,
        scenePayload: buildAssetWorkflowScenePayload(scene, { referenceAssetNames }),
        style: options.workflowStylePrompt.value,
        aspectRatio: options.projectAspectRatio.value,
        scriptParseMode: options.scriptParseMode?.value || DEFAULT_SCRIPT_PARSE_MODE,
        references: buildAssetWorkflowVideoReferences({
          scene,
          environmentAssetId: resolveSceneEnvironmentReferenceAssetId(scene),
          environmentAssetName: options.resolveAssetName(resolveSceneEnvironmentReferenceAssetId(scene)),
          environmentImage,
          continuityFirstFrame: inputs.continuityFirstFrame,
          characterImages: inputs.characterImages,
          characterAssets: inputs.characterReferenceAssets,
          narrationVoiceAsset: narrationVoiceReference
            ? {
                id: narrationVoiceReference.assetId,
                name: narrationVoiceReference.name,
                audioUrl: narrationVoiceReference.audioUrl
              }
            : undefined
        })
      }
      const createAndPollVideoTask = async () => {
        const taskId = await requestSceneVideoTask(videoTaskOptions)
        trackedVideoTasks.set(scene.id, { taskId, generationKey: currentKey })
        return await pollTrackedSceneVideoTask(scene.id, taskId)
      }

      // 上次轮询中断但任务仍在进行：继续等原任务，避免重复提交付费任务
      const trackedTask = trackedVideoTasks.get(scene.id)
      let videoResult
      if (trackedTask && (!trackedTask.generationKey || trackedTask.generationKey === currentKey)) {
        videoResult = await pollTrackedSceneVideoTask(scene.id, trackedTask.taskId)
      } else {
        try {
          videoResult = await createAndPollVideoTask()
        } catch (error) {
          if (!isRetryableVideoImageDownloadError(error)) throw error
          videoResult = await createAndPollVideoTask()
        }
      }

      const latestGenerationKey = pendingVideoGenerationKeys.get(scene.id)
      const resultKey = buildSceneVideoGenerationKey(
        scene,
        environmentImage,
        resolveSceneVideoInputs(scene)
      )
      if (latestGenerationKey !== currentKey || resultKey !== currentKey) {
        await keepOutdatedSceneVideoResult(scene, videoResult.videoUrl)
        return
      }

      await applyGeneratedSceneVideo(scene, videoResult, runOptions)
    } catch (error) {
      await markSceneVideoFailed(scene, error, runOptions)
    } finally {
      if (generationKey && pendingVideoGenerationKeys.get(scene.id) === generationKey) {
        pendingVideoGenerationKeys.delete(scene.id)
      }
    }
  }

  async function generateSingleSceneVideo(
    sceneId: string,
    runOptions: SceneVideoRunOptions = {}
  ) {
    const scene = options.scenes.value.find(item => item.id === sceneId)
    if (!scene) return

    // 同一场景已在生成时（例如批量进行中又点了重试），等待那一次而不是重复提交
    await runOnce(sceneVideoRuns, scene.id, () => runSceneVideoGeneration(scene, runOptions))
  }

  async function resumeTrackedSceneVideoTask(scene: SceneData, taskId: string) {
    updateQueueItem(scene.id, { status: 'running', error: undefined })
    scene.videoStatus = 'generating'
    scene.videoError = undefined

    try {
      const videoResult = await pollTrackedSceneVideoTask(scene.id, taskId)
      await applyGeneratedSceneVideo(scene, videoResult, {})
      updateQueueItem(scene.id, { status: 'done', error: undefined })
    } catch (error) {
      updateQueueItem(scene.id, {
        status: 'error',
        error: options.resolveUiError(error, '视频生成失败')
      })
      await markSceneVideoFailed(scene, error, {})
    }
  }

  /** 刷新或重新打开项目后，接着等待后端仍在进行的分镜视频任务 */
  async function resumeActiveSceneVideoTasks(): Promise<void> {
    const projectId = options.projectId?.value
    if (!projectId) return

    let activeTasks
    try {
      activeTasks = await fetchActiveSceneVideoTasks(projectId)
    } catch (error) {
      console.warn('[useAssetWorkbenchSceneGeneration] 查询进行中的视频任务失败:', error)
      return
    }
    if (options.projectId?.value !== projectId) return

    await Promise.all(activeTasks.map(async (task) => {
      const scene = options.scenes.value.find(item => item.id === task.sceneId)
      if (!scene || sceneVideoRuns.has(scene.id)) return

      trackedVideoTasks.set(scene.id, { taskId: task.taskId })
      try {
        await runOnce(sceneVideoRuns, scene.id, () => resumeTrackedSceneVideoTask(scene, task.taskId))
      } catch {
        // 失败信息已写到场景上
      }
    }))
  }

  async function ensureCharacterAssetsReady() {
    const missingCharacterAssets = options.characters.value.filter(character => !character.baseImage)
    if (missingCharacterAssets.length === 0) return

    await options.batchGenerateCharacters()
  }

  // 队列数组会被 synchronizeQueueItems 整体替换，必须每次按 sceneId 取当前的 item
  function findQueueItem(sceneId: string): QueueItem | undefined {
    return options.queueItems.value.find(item => item.sceneId === sceneId)
  }

  function updateQueueItem(sceneId: string, patch: Partial<Pick<QueueItem, 'status' | 'error'>>) {
    const item = findQueueItem(sceneId)
    if (item) Object.assign(item, patch)
  }

  async function runQueueItem(
    sceneId: string,
    runOptions: SceneVideoRunOptions = {}
  ) {
    updateQueueItem(sceneId, { status: 'running', error: undefined })

    try {
      await generateSingleSceneVideo(sceneId, {
        skipCompletionNotice: runOptions.skipCompletionNotice
      })
      const scene = options.scenes.value.find(candidate => candidate.id === sceneId)
      updateQueueItem(sceneId, { status: scene?.videoStatus === 'done' ? 'done' : 'pending' })
    } catch (error) {
      updateQueueItem(sceneId, {
        status: 'error',
        error: options.resolveUiError(error, '生成失败')
      })
    }
  }

  function isSceneVideoDone(sceneId: string): boolean {
    return options.scenes.value.find(item => item.id === sceneId)?.videoStatus === 'done'
  }

  /** 场景需要上一镜的尾帧，而上一镜还在本轮排队或生成中 */
  function isWaitingForContinuitySource(
    sceneId: string,
    waitingSceneIds: string[],
    runningSceneIds: Map<string, Promise<void>>
  ): boolean {
    const scene = options.scenes.value.find(item => item.id === sceneId)
    const source = scene ? resolveContinuitySourceScene(scene) : undefined
    if (!source) return false
    return waitingSceneIds.includes(source.id) || runningSceneIds.has(source.id)
  }

  /**
   * 按顺序并发生成多个场景。是否已完成在派发时才判断：
   * 前一镜重新生成后，下一镜可能被重置为待生成，需要在本轮补上。
   */
  async function runSceneQueue(sceneIds: string[], runOptions: SceneVideoRunOptions) {
    const waiting = [...sceneIds]
    const running = new Map<string, Promise<void>>()

    while (waiting.length > 0 || running.size > 0) {
      let index = 0
      while (index < waiting.length && running.size < MAX_CONCURRENT_SCENE_VIDEO_TASKS) {
        const sceneId = waiting[index]!
        // 先等上一镜：它完成后可能把本镜重置为待生成
        if (isWaitingForContinuitySource(sceneId, waiting, running)) {
          index += 1
          continue
        }
        if (isSceneVideoDone(sceneId)) {
          waiting.splice(index, 1)
          continue
        }
        waiting.splice(index, 1)
        running.set(sceneId, runQueueItem(sceneId, runOptions).finally(() => {
          running.delete(sceneId)
        }))
      }

      if (running.size === 0) {
        // 兜底：依赖关系无法满足时按顺序执行，避免死循环
        const sceneId = waiting.shift()
        if (sceneId) await runQueueItem(sceneId, runOptions)
        continue
      }

      await Promise.race(running.values())
    }
  }

  async function notifyBatchResult(
    sceneIds: string[],
    labels: { failedTitle: string, completedTitle: string }
  ) {
    const sceneIdSet = new Set(sceneIds)
    const items = options.queueItems.value.filter(item => sceneIdSet.has(item.sceneId))
    const total = items.length
    const done = items.filter(item => item.status === 'done').length
    const failed = items.filter(item => item.status === 'error').length
    if (done === 0 && failed > 0) {
      await notifyModelTaskFailed({
        title: labels.failedTitle,
        body: `完成 ${done} / ${total}，失败 ${failed}`
      })
    } else {
      await notifyModelTaskCompleted({
        title: labels.completedTitle,
        body: `完成 ${done} / ${total}${failed > 0 ? `，失败 ${failed}` : ''}`
      })
    }
  }

  async function runBatchSceneGeneration() {
    if (options.batchRunning.value) return

    await options.persistAutomaticAssetPlan()
    await ensureCharacterAssetsReady()
    const hasPendingItems = options.queueItems.value.some(item => item.status !== 'done')
    if (!hasPendingItems) return

    options.batchRunning.value = true

    try {
      const sceneIds = options.queueItems.value.map(item => item.sceneId)
      await runSceneQueue(sceneIds, { skipCompletionNotice: true })
      await notifyBatchResult(sceneIds, {
        failedTitle: '批量生成分镜视频失败',
        completedTitle: '批量生成分镜视频完成'
      })
    } finally {
      options.batchRunning.value = false
    }
  }

  async function runBatchSceneGenerationByEpisode(episodeId: string) {
    const normalizedEpisodeId = episodeId.trim()
    if (!normalizedEpisodeId || options.batchRunning.value) return

    await options.persistAutomaticAssetPlan()
    await ensureCharacterAssetsReady()

    const targetSceneIdSet = new Set(
      options.scenes.value
        .filter(scene => (scene.episodeId?.trim() || '') === normalizedEpisodeId)
        .map(scene => scene.id)
    )
    if (targetSceneIdSet.size === 0) return

    const targetSceneIds = options.queueItems.value
      .filter(item => targetSceneIdSet.has(item.sceneId))
      .map(item => item.sceneId)
    const hasPendingItems = targetSceneIds.some(sceneId => findQueueItem(sceneId)?.status !== 'done')
    if (!hasPendingItems) return

    options.batchRunning.value = true

    try {
      await runSceneQueue(targetSceneIds, { skipCompletionNotice: true })
      await notifyBatchResult(targetSceneIds, {
        failedTitle: '当前分集分镜视频生成失败',
        completedTitle: '当前分集分镜视频已生成'
      })
    } finally {
      options.batchRunning.value = false
    }
  }

  async function retryScene(sceneId: string) {
    if (!findQueueItem(sceneId)) return

    await runQueueItem(sceneId, {
      skipCompletionNotice: false
    })
  }

  /** Retries the given scenes through the shared queue so the concurrency limit still applies. */
  async function retryScenes(sceneIds: string[]) {
    const ids = sceneIds.filter(sceneId => !!findQueueItem(sceneId))
    if (ids.length === 0) return
    await runSceneQueue(ids, { skipCompletionNotice: false })
  }

  async function retryFailedQueueItemsOnce() {
    const failedSceneIds = options.queueItems.value
      .filter(item => item.status === 'error')
      .map(item => item.sceneId)
    await runSceneQueue(failedSceneIds, { skipCompletionNotice: false })
  }

  return {
    buildAssetWorkflowScenePayload,
    generateSceneBaseline,
    ensureCharacterAssetsReady,
    runBatchSceneGeneration,
    runBatchSceneGenerationByEpisode,
    retryScene,
    retryScenes,
    retryFailedQueueItemsOnce,
    resumeActiveSceneVideoTasks
  }
}
