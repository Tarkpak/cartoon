import type { ComputedRef, Ref } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import {
  applySceneBaselineReference,
  applySceneVideoUrl,
  buildAssetWorkflowScenePayload as createAssetWorkflowScenePayload,
  buildAssetWorkflowVideoReferences,
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
import { uniqueSorted } from '~/lib/asset-workbench-strings'
import {
  findReusableEnvironmentImage,
  resolveSceneEnvironmentAssetId,
  resolveSceneEnvironmentLabel,
  resolveSceneReferenceImage
} from '~/lib/asset-workbench-environment'
import {
  resolveConfiguredCharacterReferences,
  resolveSceneVideoCharacterReferences,
  resolveSceneVideoReferenceAssets
} from '~/lib/asset-workbench-scene-references'
import {
  resolveEnvironmentCaptureModeForScene,
  resolveEnvironmentReferenceImageByCaptureMode
} from '~/lib/asset-workbench-environment-views'

const ENVIRONMENT_REFERENCE_ASPECT_RATIO = '16:9' as const

interface UseAssetWorkbenchSceneGenerationOptions {
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  sceneConfigs: Ref<Record<string, SceneConsistencyConfig>>
  propAssets: Ref<PropAsset[]>
  queueItems: Ref<QueueItem[]>
  batchRunning: Ref<boolean>
  workflowStylePrompt: ComputedRef<string>
  projectAspectRatio: Ref<'16:9' | '9:16' | '1:1'>
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
}

export function useAssetWorkbenchSceneGeneration(
  options: UseAssetWorkbenchSceneGenerationOptions
) {
  const pendingBaselineGenerationKeys = new Map<string, string>()
  const pendingVideoGenerationKeys = new Map<string, string>()

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
    const environmentAssetId = resolveSceneEnvironmentAssetId(scene)
    options.recordEnvironmentHistory?.(
      environmentAssetId,
      reusableImage,
      { source: 'legacy' }
    )
    options.synchronizeQueueItems()
    await options.saveProject()
    return true
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
        await options.generateCharacter(character, {
          skipCompletionNotice: true
        })
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
      const relatedScenes = options.scenes.value.filter(item => resolveSceneEnvironmentAssetId(item) === environmentId)
      if (relatedScenes.length === 0) continue

      const readyScene = relatedScenes.find((item) => {
        return !!resolveSceneAvailableReferenceImage(item)
      })
      if (readyScene) continue

      const fallbackScene = relatedScenes.find((item) => {
        return item.referenceStatus !== 'generating' && item.videoStatus !== 'generating'
      }) || relatedScenes[0]
      if (!fallbackScene) continue

      await generateSceneBaseline(fallbackScene.id, { preferReuse: true })

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

      await generateSceneBaseline(referencedSceneId, { preferReuse: true })

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

  function buildAssetWorkflowScenePayload(scene: SceneData) {
    return createAssetWorkflowScenePayload({
      scene,
      scenes: options.scenes.value,
      sceneConfig: options.ensureSceneConfig(scene.id),
      resolveAssetName: options.resolveAssetName,
      resolveSceneDescriptionWithoutAssetMentions: options.resolveSceneDescriptionWithoutAssetMentions
    })
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
  } {
    const customPrompt = generationOptions.customPrompt?.trim() || ''
    const consistencyReferenceImage = generationOptions.consistencyReferenceImage?.trim() || ''
    const sceneReferenceImage = options.resolveSceneBaselineReferenceImage?.(scene)?.trim()
      || resolveSceneReferenceImage(scene)
      || scene.firstFrame?.trim()
      || undefined

    if (customPrompt) {
      return {
        referenceImage: sceneReferenceImage
      }
    }

    if (!consistencyReferenceImage) {
      return {}
    }

    return {
      consistencyReferenceImage
    }
  }

  function buildSceneVideoGenerationKey(
    scene: SceneData,
    environmentImage: string,
    continuityFirstFrame: string | undefined,
    characterImages: string[],
    characterReferenceAssets: ReturnType<typeof resolveSceneVideoReferenceAssets>
  ): string {
    return JSON.stringify({
      scenePayload: buildAssetWorkflowScenePayload(scene),
      style: options.workflowStylePrompt.value,
      aspectRatio: options.projectAspectRatio.value,
      environmentImage,
      continuityFirstFrame: continuityFirstFrame || '',
      characterImages,
      characterAssets: characterReferenceAssets.map(asset => ({
        assetId: asset.assetId,
        name: asset.name,
        type: asset.type,
        image: asset.image,
        source: asset.source
      }))
    })
  }

  function resolvePreviousSceneLastFrameForContinuity(scene: SceneData): string | undefined {
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

    return previous.lastFrame?.trim() || undefined
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
        const environmentAssetId = resolveSceneEnvironmentAssetId(scene)
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
        scene,
        scenes: options.scenes.value,
        scenePayload: buildAssetWorkflowScenePayload(scene),
        style: options.workflowStylePrompt.value,
        aspectRatio: ENVIRONMENT_REFERENCE_ASPECT_RATIO,
        customPrompt,
        referenceImage: referenceInputs.referenceImage,
        consistencyReferenceImage: referenceInputs.consistencyReferenceImage
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

      const environmentAssetId = resolveSceneEnvironmentAssetId(scene)
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
            || (croppedResult.captureMode === 'single'
              ? croppedResult.imageUrl?.trim()
              : undefined)
          const normalizedFourViewImage = croppedResult.fourViewImage?.trim()
            || (croppedResult.captureMode === 'four_view'
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
      if (captureMode === 'four_view') {
        panoramaState.captureMode = 'four_view'
      }
      if (singleViewImage?.trim()) {
        panoramaState.singleViewImage = singleViewImage
      }
      if (fourViewImage?.trim()) {
        panoramaState.fourViewImage = fourViewImage
      }
      options.setEnvironmentPanoramaState?.(environmentAssetId, panoramaState)
      const normalizedSingleViewImage = singleViewImage?.trim()
        || (captureMode === 'single'
          ? referenceImage?.trim()
          : undefined)
      const normalizedFourViewImage = fourViewImage?.trim()
        || (captureMode === 'four_view'
          ? referenceImage?.trim()
          : undefined)

      if (normalizedSingleViewImage) {
        options.recordEnvironmentHistory?.(
          environmentAssetId,
          normalizedSingleViewImage,
          {
            source: 'generated',
            prompt: customPrompt,
            viewMode: 'single'
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
            viewMode: 'four_view'
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
        await options.onModelTaskCompleted?.({
          title: customPrompt ? '环境图二次生成完成' : '环境图生成完成',
          body: `场景：${scene.title}`
        })
      }
    } catch (error) {
      scene.referenceStatus = 'error'
      scene.referenceError = options.resolveUiError(error, '环境图生成失败')
      throw new Error(scene.referenceError)
    } finally {
      if (pendingBaselineGenerationKeys.get(scene.id) === generationKey) {
        pendingBaselineGenerationKeys.delete(scene.id)
      }
    }
  }

  async function generateSingleSceneVideo(
    sceneId: string,
    runOptions: {
      skipCompletionNotice?: boolean
    } = {}
  ) {
    const scene = options.scenes.value.find(item => item.id === sceneId)
    if (!scene) return

    await ensureSceneReferencedAssetsReady(scene)

    if (!resolveSceneAvailableReferenceImage(scene)) {
      await applySceneReferenceIfAvailable(scene)
    }

    if (!resolveSceneAvailableReferenceImage(scene)) {
      await generateSceneBaseline(scene.id, { preferReuse: true })
    }
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

    const characterReferenceAssets = resolveSceneVideoReferenceAssets({
      scene,
      characters: options.characters.value,
      propAssets: options.propAssets.value,
      sceneConfigs: options.sceneConfigs.value
    })
    const characterImages = resolveSceneVideoCharacterReferences({
      scene,
      characters: options.characters.value,
      propAssets: options.propAssets.value,
      sceneConfigs: options.sceneConfigs.value
    })
    const continuityFirstFrame = resolvePreviousSceneLastFrameForContinuity(scene)
    const generationKey = buildSceneVideoGenerationKey(
      scene,
      environmentImage,
      continuityFirstFrame,
      characterImages,
      characterReferenceAssets
    )
    pendingVideoGenerationKeys.set(scene.id, generationKey)

    scene.videoStatus = 'generating'
    scene.videoError = undefined

    try {
      const taskId = await requestSceneVideoTask({
        scenePayload: buildAssetWorkflowScenePayload(scene),
        style: options.workflowStylePrompt.value,
        aspectRatio: options.projectAspectRatio.value,
        references: buildAssetWorkflowVideoReferences({
          scene,
          environmentImage,
          continuityFirstFrame,
          characterImages,
          characterAssets: characterReferenceAssets
        })
      })
      const videoResult = await pollSceneVideoTask(taskId)

      const latestGenerationKey = pendingVideoGenerationKeys.get(scene.id)
      const currentGenerationKey = buildSceneVideoGenerationKey(
        scene,
        environmentImage,
        resolvePreviousSceneLastFrameForContinuity(scene),
        resolveSceneVideoCharacterReferences({
          scene,
          characters: options.characters.value,
          propAssets: options.propAssets.value,
          sceneConfigs: options.sceneConfigs.value
        }),
        resolveSceneVideoReferenceAssets({
          scene,
          characters: options.characters.value,
          propAssets: options.propAssets.value,
          sceneConfigs: options.sceneConfigs.value
        })
      )
      if (latestGenerationKey !== generationKey || currentGenerationKey !== generationKey) {
        const invalidated = invalidateSceneVideoState(scene)
        if (invalidated) {
          options.synchronizeQueueItems()
          await options.saveProject()
        }
        return
      }

      applySceneVideoUrl(scene, videoResult.videoUrl)
      if (videoResult.lastFrame) {
        scene.lastFrame = videoResult.lastFrame
      }
      options.recordSceneVideoHistory?.(scene.id, videoResult.videoUrl, {
        source: 'generated'
      })
      await options.saveProject()
      if (!runOptions.skipCompletionNotice) {
        await options.onModelTaskCompleted?.({
          title: '分镜视频生成完成',
          body: `场景：${scene.title}`
        })
      }
      void options.refreshCharacterVoiceAssets?.({
        attempts: 4,
        delayMs: 1500
      })
    } catch (error) {
      scene.videoStatus = 'error'
      scene.videoError = options.resolveUiError(error, '视频生成失败')
      throw new Error(scene.videoError)
    } finally {
      if (pendingVideoGenerationKeys.get(scene.id) === generationKey) {
        pendingVideoGenerationKeys.delete(scene.id)
      }
    }
  }

  async function ensureCharacterAssetsReady() {
    const missingCharacterAssets = options.characters.value.filter(character => !character.baseImage)
    if (missingCharacterAssets.length === 0) return

    await options.batchGenerateCharacters()
  }

  async function runQueueItem(
    item: QueueItem,
    runOptions: {
      skipCompletionNotice?: boolean
    } = {}
  ) {
    item.status = 'running'
    item.error = undefined

    try {
      await generateSingleSceneVideo(item.sceneId, {
        skipCompletionNotice: runOptions.skipCompletionNotice
      })
      const scene = options.scenes.value.find(candidate => candidate.id === item.sceneId)
      item.status = scene?.videoStatus === 'done' ? 'done' : 'pending'
    } catch (error) {
      item.status = 'error'
      item.error = options.resolveUiError(error, '生成失败')
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
      for (const item of options.queueItems.value) {
        if (item.status === 'done') continue
        await runQueueItem(item, {
          skipCompletionNotice: true
        })
      }
      const total = options.queueItems.value.length
      const done = options.queueItems.value.filter(item => item.status === 'done').length
      const failed = options.queueItems.value.filter(item => item.status === 'error').length
      await options.onModelTaskCompleted?.({
        title: '批量生成分镜视频完成',
        body: `完成 ${done} / ${total}${failed > 0 ? `，失败 ${failed}` : ''}`
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

    const targetItems = options.queueItems.value.filter(item => targetSceneIdSet.has(item.sceneId))
    const hasPendingItems = targetItems.some(item => item.status !== 'done')
    if (!hasPendingItems) return

    options.batchRunning.value = true

    try {
      for (const item of targetItems) {
        if (item.status === 'done') continue
        await runQueueItem(item, {
          skipCompletionNotice: true
        })
      }
      const total = targetItems.length
      const done = targetItems.filter(item => item.status === 'done').length
      const failed = targetItems.filter(item => item.status === 'error').length
      await options.onModelTaskCompleted?.({
        title: '当前分集分镜视频已生成',
        body: `完成 ${done} / ${total}${failed > 0 ? `，失败 ${failed}` : ''}`
      })
    } finally {
      options.batchRunning.value = false
    }
  }

  async function retryScene(sceneId: string) {
    const item = options.queueItems.value.find(queue => queue.sceneId === sceneId)
    if (!item) return

    await runQueueItem(item, {
      skipCompletionNotice: false
    })
  }

  async function retryFailedQueueItemsOnce() {
    const failedItems = options.queueItems.value.filter(item => item.status === 'error')
    for (const item of failedItems) {
      await retryScene(item.sceneId)
    }
  }

  return {
    buildAssetWorkflowScenePayload,
    generateSceneBaseline,
    ensureCharacterAssetsReady,
    runBatchSceneGeneration,
    runBatchSceneGenerationByEpisode,
    retryScene,
    retryFailedQueueItemsOnce
  }
}
