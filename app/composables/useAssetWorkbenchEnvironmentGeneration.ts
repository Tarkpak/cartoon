import type { ComputedRef, Ref } from 'vue'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type {
  DisplayAsset,
  EnvironmentAssetCard,
  EnvironmentCropCaptureMode,
  EnvironmentCropSelection,
  EnvironmentPanoramaState
} from '~/lib/asset-workbench-types'
import { resolveEnvironmentAssetGenerationSetting } from '~/lib/asset-workbench-environment'
import { extractAssetIdsFromSceneChatText } from '~/lib/asset-workbench-scene-chat'
import type { GenerateSceneBaselineOptions } from '~/lib/asset-workbench-scene-generation'
import type { EnvironmentCropImageResult } from '~/composables/useAssetWorkbenchEnvironmentCrop'

type EnvironmentGenerationState = { status: 'error' | 'done' | 'pending' | 'generating', error?: string }

/**
 * Environment reference generation from an asset card (no representative
 * scene), and the regenerate dialog submit that picks between the card path
 * and the scene-baseline path.
 */
export function useAssetWorkbenchEnvironmentGeneration(options: {
  projectId: Ref<string | undefined>
  referenceAspectRatio: string
  workflowStylePrompt: ComputedRef<string>
  autoRunError: Ref<string | null>
  environmentAssetGenerationStates: Ref<Record<string, EnvironmentGenerationState>>
  environmentRegenerateTarget: ComputedRef<EnvironmentAssetCard | null>
  environmentRegeneratePrompt: Ref<string>
  environmentRegenerateError: Ref<string | null>
  setEnvironmentRegenerateDialogOpen: (open: boolean) => void
  submitEnvironmentRegenerationCore: (input?: { consistencyReferenceImage?: string, consistencyReferenceImages?: string[] }) => Promise<void>
  setEnvironmentAssetGenerationState: (assetId: string, state: EnvironmentGenerationState | null) => void
  setEnvironmentPanoramaState: (assetId: string, state: EnvironmentPanoramaState | undefined) => void
  resolveEnvironmentCard: (assetId: string) => EnvironmentAssetCard | undefined
  resolveEnvironmentPanoramaState: (assetId: string) => EnvironmentPanoramaState | undefined
  resolveEnvironmentAssetReferenceImage: (assetId: string) => string | undefined
  resolveEnvironmentRepresentativeScene: (assetId: string) => SceneData | undefined
  resolveEnvironmentSelectedMotherReferenceImage: (assetId: string) => string | undefined
  resolveAssetByMentionTokenMap: () => Map<string, DisplayAsset>
  resolveDisplayAssetById: (assetId: string) => DisplayAsset | undefined
  createEnvironmentCropImage: (options: {
    assetId: string
    sourceImage: string
    crop?: EnvironmentCropSelection
    captureMode?: EnvironmentCropCaptureMode
    aspectRatio?: string
  }) => Promise<EnvironmentCropImageResult>
  recordEnvironmentHistory: (
    assetId: string,
    image: string,
    options?: { source?: 'generated' | 'uploaded' | 'cropped' | 'legacy', prompt?: string, viewMode?: EnvironmentCropCaptureMode }
  ) => void
  handleGenerateSceneBaseline: (sceneId: string, options?: GenerateSceneBaselineOptions) => Promise<void>
  saveWorkflowMeta: () => Promise<unknown>
  resolveUiError: (error: unknown, fallback: string) => string
  notifyGenerationCompleted: (payload: { title: string, body?: string, type?: 'success' | 'error' }) => Promise<void>
  notifyGenerationFailed: (payload: { title: string, body?: string }) => Promise<void>
}) {
  const {
    projectId,
    referenceAspectRatio,
    workflowStylePrompt,
    autoRunError,
    environmentAssetGenerationStates,
    environmentRegenerateTarget,
    environmentRegeneratePrompt,
    environmentRegenerateError,
    setEnvironmentRegenerateDialogOpen,
    submitEnvironmentRegenerationCore,
    setEnvironmentAssetGenerationState,
    setEnvironmentPanoramaState,
    resolveEnvironmentCard,
    resolveEnvironmentPanoramaState,
    resolveEnvironmentAssetReferenceImage,
    resolveEnvironmentRepresentativeScene,
    resolveEnvironmentSelectedMotherReferenceImage,
    resolveAssetByMentionTokenMap,
    resolveDisplayAssetById,
    createEnvironmentCropImage,
    recordEnvironmentHistory,
    handleGenerateSceneBaseline,
    saveWorkflowMeta,
    resolveUiError,
    notifyGenerationCompleted,
    notifyGenerationFailed
  } = options

  async function regenerateEnvironmentAsset(assetId: string) {
    const consistencyReferenceImage = resolveEnvironmentSelectedMotherReferenceImage(assetId)
    const targetScene = resolveEnvironmentRepresentativeScene(assetId)
    if (!targetScene) {
      await generateEnvironmentAssetFromCard(assetId, {
        consistencyReferenceImage
      })
      return
    }
    await handleGenerateSceneBaseline(targetScene.id, {
      consistencyReferenceImage
    })
  }

  async function generateEnvironmentAssetFromCard(
    assetId: string,
    options: {
      customPrompt?: string
      consistencyReferenceImage?: string
      consistencyReferenceImages?: string[]
    } = {}
  ): Promise<boolean | 'busy'> {
    const asset = resolveEnvironmentCard(assetId)
    if (!asset) return false
    if (environmentAssetGenerationStates.value[assetId]?.status === 'generating') return 'busy'

    const customPrompt = options.customPrompt?.trim() || ''
    const consistencyReferenceImage = options.consistencyReferenceImage?.trim() || ''
    const consistencyReferenceImages = Array.isArray(options.consistencyReferenceImages)
      ? Array.from(new Set(
          options.consistencyReferenceImages
            .map(value => value?.trim() || '')
            .filter(Boolean)
        ))
      : []
    const isRegeneration = !!customPrompt
    const regenerationReferenceImage = isRegeneration
      ? (
          resolveEnvironmentPanoramaState(assetId)?.panoramaImage?.trim()
          || asset.referenceImage?.trim()
          || asset.panoramaImage?.trim()
          || ''
        )
      : ''
    const fallbackError = isRegeneration ? '环境二次生成失败' : '环境图生成失败'

    if (isRegeneration && !regenerationReferenceImage) {
      const message = '环境参考图不存在，请先生成或上传环境图'
      autoRunError.value = message
      setEnvironmentAssetGenerationState(assetId, {
        status: 'error',
        error: message
      })
      return false
    }

    autoRunError.value = null
    setEnvironmentAssetGenerationState(assetId, { status: 'generating' })

    try {
      const generationSetting = resolveEnvironmentAssetGenerationSetting(
        asset,
        resolveEnvironmentRepresentativeScene(assetId)
      )
      const response = await $fetch<{
        success: boolean
        referenceImage?: string
        error?: string
      }>('/api/asset-workflow/reference/generate', {
        method: 'POST',
        body: {
          projectId: projectId.value,
          scene: {
            id: asset.id,
            title: asset.name,
            description: asset.description || asset.sceneTitles.join('、') || asset.name,
            duration: 8,
            setting: {
              location: generationSetting.location,
              timeOfDay: generationSetting.timeOfDay,
              mood: generationSetting.mood
            },
            characters: []
          },
          style: workflowStylePrompt.value,
          aspectRatio: referenceAspectRatio,
          environmentContext: {
            environmentRoot: generationSetting.location,
            anchorLocation: generationSetting.location,
            anchorDescription: asset.description || '',
            siblingLocations: []
          },
          regeneration: isRegeneration
            ? {
                customPrompt,
                referenceImage: regenerationReferenceImage
              }
            : undefined,
          consistencyReferenceImage: consistencyReferenceImage || undefined,
          consistencyReferenceImages: consistencyReferenceImages.length > 0
            ? consistencyReferenceImages
            : undefined
        }
      })

      if (!response.success || !response.referenceImage) {
        throw new Error(response.error || fallbackError)
      }

      let finalReferenceImage = response.referenceImage
      let crop: EnvironmentCropSelection | undefined
      let captureMode: EnvironmentCropCaptureMode | undefined
      let singleViewImage: string | undefined
      let fourViewImage: string | undefined
      try {
        captureMode = resolveEnvironmentPanoramaState(assetId)?.captureMode
          || asset.captureMode
        const croppedResult = await createEnvironmentCropImage({
          assetId,
          sourceImage: response.referenceImage,
          crop: asset.crop,
          captureMode,
          aspectRatio: referenceAspectRatio
        })
        finalReferenceImage = croppedResult.imageUrl
        crop = croppedResult.crop
        captureMode = croppedResult.captureMode
        singleViewImage = croppedResult.singleViewImage
        fourViewImage = croppedResult.fourViewImage
      } catch (error) {
        console.warn('[AssetWorkbench] 环境资产图裁切失败，已回退使用原始环境图', {
          assetId,
          reason: error instanceof Error ? error.message : String(error)
        })
      }

      setEnvironmentPanoramaState(assetId, {
        panoramaImage: response.referenceImage,
        crop,
        captureMode,
        singleViewImage,
        fourViewImage
      })
      const normalizedSingleViewImage = singleViewImage?.trim() || ''
      const normalizedFourViewImage = fourViewImage?.trim() || ''

      if (normalizedSingleViewImage) {
        recordEnvironmentHistory(assetId, normalizedSingleViewImage, {
          source: 'generated',
          prompt: customPrompt || undefined,
          viewMode: '单视角'
        })
      }
      if (normalizedFourViewImage) {
        recordEnvironmentHistory(assetId, normalizedFourViewImage, {
          source: 'generated',
          prompt: customPrompt || undefined,
          viewMode: '四视角'
        })
      }
      if (!normalizedSingleViewImage && !normalizedFourViewImage && finalReferenceImage?.trim()) {
        recordEnvironmentHistory(assetId, finalReferenceImage, {
          source: 'generated',
          prompt: customPrompt || undefined
        })
      }
      await saveWorkflowMeta()
      setEnvironmentAssetGenerationState(assetId, null)
      await notifyGenerationCompleted({
        title: isRegeneration ? '环境图二次生成完成' : '环境图生成完成',
        body: `环境：${asset.name}`
      })
      return true
    } catch (error) {
      const message = resolveUiError(error, fallbackError)
      setEnvironmentAssetGenerationState(assetId, {
        status: 'error',
        error: message
      })
      autoRunError.value = message
      await notifyGenerationFailed({
        title: isRegeneration ? '环境图二次生成失败' : '环境图生成失败',
        body: `环境：${asset.name}（${message}）`
      })
      return false
    }
  }

  async function submitEnvironmentRegeneration() {
    const target = environmentRegenerateTarget.value
    const prompt = environmentRegeneratePrompt.value.trim()
    const mentionMap = resolveAssetByMentionTokenMap()
    const mentionAssetIds = prompt
      ? extractAssetIdsFromSceneChatText(prompt, mentionMap)
      : []
    const consistencyReferenceImages = Array.from(new Set(
      mentionAssetIds
        .map(assetId => resolveDisplayAssetById(assetId))
        .filter((asset): asset is DisplayAsset => !!asset && asset.type === 'environment' && asset.id !== target?.id)
        .map(asset => resolveEnvironmentAssetReferenceImage(asset.id) || '')
        .filter(Boolean)
    ))
    const consistencyReferenceImage = consistencyReferenceImages[0]

    if (!target) {
      await submitEnvironmentRegenerationCore({
        consistencyReferenceImage,
        consistencyReferenceImages
      })
      return
    }

    const targetScene = resolveEnvironmentRepresentativeScene(target.id)
    if (targetScene) {
      await submitEnvironmentRegenerationCore({
        consistencyReferenceImage,
        consistencyReferenceImages
      })
      return
    }

    if (!prompt) {
      environmentRegenerateError.value = '请输入二次生成提示词'
      return
    }

    environmentRegenerateError.value = null
    const succeeded = await generateEnvironmentAssetFromCard(target.id, {
      customPrompt: prompt,
      consistencyReferenceImage,
      consistencyReferenceImages
    })
    if (succeeded === 'busy') {
      return
    }
    if (!succeeded) {
      environmentRegenerateError.value = autoRunError.value || '环境二次生成失败'
      return
    }

    setEnvironmentRegenerateDialogOpen(false)
  }

  return {
    regenerateEnvironmentAsset,
    submitEnvironmentRegeneration
  }
}
