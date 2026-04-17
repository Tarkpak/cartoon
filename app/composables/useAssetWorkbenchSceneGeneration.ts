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
import type { QueueItem } from '~/lib/asset-workbench-types'
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
  generateCharacter: (
    character: CharacterData,
    options?: {
      workflowType?: 'asset_consistency'
      regenerationPrompt?: string
      referenceImage?: string
    }
  ) => Promise<unknown>
  batchGenerateCharacters: (
    onProgress?: (current: number, total: number, name: string) => void,
    options?: { workflowType?: 'asset_consistency' }
  ) => Promise<unknown>
  persistAutomaticAssetPlan: (
    options?: { overwriteExistingConfigs?: boolean }
  ) => Promise<unknown>
}

export function useAssetWorkbenchSceneGeneration(
  options: UseAssetWorkbenchSceneGenerationOptions
) {
  async function ensureSceneReferencedAssetsReady(scene: SceneData): Promise<void> {
    const config = options.ensureSceneConfig(scene.id)

    const referencedCharacters = resolveConfiguredCharacterReferences({
      scene,
      characters: options.characters.value,
      sceneConfigs: options.sceneConfigs.value
    })
    for (const character of referencedCharacters) {
      if (character.baseImage?.trim()) continue

      try {
        await options.generateCharacter(character, {
          workflowType: 'asset_consistency'
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
        return !!resolveSceneReferenceImage(item) && item.frameStatus === 'done'
      })
      if (readyScene) continue

      const fallbackScene = relatedScenes.find((item) => {
        return item.frameStatus !== 'generating' && item.videoStatus !== 'generating'
      }) || relatedScenes[0]
      if (!fallbackScene) continue

      await generateSceneBaseline(fallbackScene.id, { preferReuse: true })

      if (fallbackScene.frameStatus === 'error') {
        throw new Error(
          options.normalizeWorkflowText(
            fallbackScene.frameError || `引用环境「${resolveSceneEnvironmentLabel(fallbackScene)}」生成失败`
          )
        )
      }

      if (!resolveSceneReferenceImage(fallbackScene)) {
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

      const referenceImage = resolveSceneReferenceImage(referencedScene)
      if (referenceImage && referencedScene.frameStatus === 'done') continue

      await generateSceneBaseline(referencedSceneId, { preferReuse: true })

      if (referencedScene.frameStatus === 'error') {
        throw new Error(
          options.normalizeWorkflowText(
            referencedScene.frameError || `引用场景「${referencedScene.title}」环境图生成失败`
          )
        )
      }

      if (!resolveSceneReferenceImage(referencedScene)) {
        throw new Error(`引用场景资产未就绪：${referencedScene.title}`)
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

  async function generateSceneBaseline(
    sceneId: string,
    generationOptions: GenerateSceneBaselineOptions = {}
  ) {
    const scene = options.scenes.value.find(item => item.id === sceneId)
    if (!scene) return
    if (scene.frameStatus === 'generating' || scene.videoStatus === 'generating') return

    const customPrompt = generationOptions.customPrompt?.trim()

    if (generationOptions.preferReuse && !customPrompt) {
      const reusableImage = findReusableEnvironmentImage(scene, options.scenes.value)
      if (reusableImage) {
        applySceneBaselineReference(scene, reusableImage)
        options.synchronizeQueueItems()
        await options.saveProject()
        return
      }
    }

    scene.frameStatus = 'generating'
    scene.frameError = undefined

    try {
      const referenceImage = await requestSceneBaselineGeneration({
        scene,
        scenes: options.scenes.value,
        scenePayload: buildAssetWorkflowScenePayload(scene),
        style: options.workflowStylePrompt.value,
        aspectRatio: options.projectAspectRatio.value,
        customPrompt
      })
      applySceneBaselineReference(scene, referenceImage)
      options.synchronizeQueueItems()
      await options.saveProject()
    } catch (error) {
      scene.frameStatus = 'error'
      scene.frameError = options.resolveUiError(error, '环境图生成失败')
      throw new Error(scene.frameError)
    }
  }

  async function generateSingleSceneVideo(sceneId: string) {
    const scene = options.scenes.value.find(item => item.id === sceneId)
    if (!scene) return

    await ensureSceneReferencedAssetsReady(scene)

    if (!resolveSceneReferenceImage(scene)) {
      await generateSceneBaseline(scene.id, { preferReuse: true })
    }
    if (scene.frameStatus === 'error') {
      throw new Error(options.normalizeWorkflowText(scene.frameError || '场景环境图生成失败'))
    }

    const environmentImage = resolveSceneReferenceImage(scene)
    if (!environmentImage) {
      throw new Error('场景环境图未就绪，无法生成视频')
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
          characterImages,
          characterAssets: characterReferenceAssets
        })
      })
      const videoUrl = await pollSceneVideoTask(taskId)
      applySceneVideoUrl(scene, videoUrl)
      await options.saveProject()
    } catch (error) {
      scene.videoStatus = 'error'
      scene.videoError = options.resolveUiError(error, '视频生成失败')
      throw new Error(scene.videoError)
    }
  }

  async function ensureCharacterAssetsReady() {
    const missingCharacterAssets = options.characters.value.filter(character => !character.baseImage)
    if (missingCharacterAssets.length === 0) return

    await options.batchGenerateCharacters(undefined, {
      workflowType: 'asset_consistency'
    })
  }

  async function runQueueItem(item: QueueItem) {
    item.status = 'running'
    item.error = undefined

    try {
      await generateSingleSceneVideo(item.sceneId)
      item.status = 'done'
    } catch (error) {
      item.status = 'error'
      item.error = options.resolveUiError(error, '生成失败')
    }
  }

  async function runBatchSceneGeneration() {
    if (options.batchRunning.value) return

    await options.persistAutomaticAssetPlan()
    await ensureCharacterAssetsReady()

    options.batchRunning.value = true

    try {
      for (const item of options.queueItems.value) {
        if (item.status === 'done') continue
        await runQueueItem(item)
      }
    } finally {
      options.batchRunning.value = false
    }
  }

  async function retryScene(sceneId: string) {
    const item = options.queueItems.value.find(queue => queue.sceneId === sceneId)
    if (!item) return

    await runQueueItem(item)
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
    retryScene,
    retryFailedQueueItemsOnce
  }
}
