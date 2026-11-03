import type { Ref } from 'vue'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type {
  EnvironmentAssetCard,
  EnvironmentCropCaptureMode,
  EnvironmentCropSelection,
  EnvironmentPanoramaState
} from '~/lib/asset-workbench-types'
import {
  buildDefaultCropSelection,
  loadCropImageMetrics,
  normalizePanoramaSelectionForAspectRatio,
  resolveEnvironmentCropCaptureMode,
  renderPanoramaFourViewToDataUrl,
  renderPanoramaSelectionToDataUrl
} from '~/lib/asset-workbench-environment-panorama'
import {
  resolveEnvironmentReferenceImageByCaptureMode,
  resolveEnvironmentReferenceImageForScene,
  resolveEnvironmentViewImageForCard
} from '~/lib/asset-workbench-environment-views'
import {
  resolveSceneEnvironmentAssetId,
  resolveSceneEnvironmentAssetIdAliases
} from '~/lib/asset-workbench-environment'
import { applySceneBaselineReference } from '~/lib/asset-workbench-scene-generation'
import { uploadAssetImage } from '~/lib/asset-workbench-upload'

/**
 * Environment reference images: panorama/crop state per environment asset
 * (keyed by all of its aliases), the single/four-view image a scene should use,
 * cropping a panorama into views, and applying a new reference to every scene.
 */
export function useAssetWorkbenchEnvironmentReferences(options: {
  projectId: Ref<string | undefined>
  scenes: Ref<SceneData[]>
  sceneConfigs: Ref<Record<string, SceneConsistencyConfig>>
  environmentPanoramaStates: Ref<Record<string, EnvironmentPanoramaState>>
  referenceAspectRatio: string
  panoramaSourceAspectRatio: Ref<string>
  resolveEnvironmentCard: (assetId: string) => EnvironmentAssetCard | undefined
  resolveSceneReferenceImage: (scene: SceneData) => string | undefined
  synchronizeQueueItems: () => void
  saveProject: () => Promise<unknown>
}) {
  const {
    projectId,
    scenes,
    sceneConfigs,
    environmentPanoramaStates,
    referenceAspectRatio,
    panoramaSourceAspectRatio,
    resolveEnvironmentCard,
    resolveSceneReferenceImage,
    synchronizeQueueItems,
    saveProject
  } = options

  function resolveEnvironmentPanoramaState(assetId: string): EnvironmentPanoramaState | undefined {
    return environmentPanoramaStates.value[assetId]
  }

  function resolveSceneEnvironmentReferenceAssetId(scene: SceneData): string {
    const configuredAssetId = sceneConfigs.value[scene.id]?.environmentAssetId?.trim() || ''
    if (configuredAssetId && resolveEnvironmentCard(configuredAssetId)) {
      return configuredAssetId
    }
    return resolveSceneEnvironmentAssetId(scene)
  }

  function resolveSceneEnvironmentReferenceAssetAliases(scene: SceneData): string[] {
    const configuredAssetId = sceneConfigs.value[scene.id]?.environmentAssetId?.trim() || ''
    if (configuredAssetId && resolveEnvironmentCard(configuredAssetId)) {
      return resolveEnvironmentPanoramaStateAliasKeys(configuredAssetId)
    }

    return resolveSceneEnvironmentAssetIdAliases(scene)
  }

  function resolveEnvironmentPanoramaStateAliasKeys(assetId: string): string[] {
    const keys = new Set<string>([assetId])
    const card = resolveEnvironmentCard(assetId)
    if (!card) return Array.from(keys)

    for (const sceneId of card.sceneIds) {
      const scene = scenes.value.find(item => item.id === sceneId)
      if (!scene) continue
      for (const alias of resolveSceneEnvironmentAssetIdAliases(scene)) {
        keys.add(alias)
      }
    }

    return Array.from(keys)
  }

  function resolveEnvironmentPanoramaStateForScene(scene: SceneData): EnvironmentPanoramaState | undefined {
    let panoramaImage: string | undefined
    let singleViewImage: string | undefined
    let fourViewImage: string | undefined
    let crop: EnvironmentCropSelection | undefined
    let captureMode: EnvironmentCropCaptureMode | undefined

    for (const alias of resolveSceneEnvironmentReferenceAssetAliases(scene)) {
      const state = environmentPanoramaStates.value[alias]
      if (!state) continue

      if (!panoramaImage && state.panoramaImage?.trim()) {
        panoramaImage = state.panoramaImage.trim()
      }
      if (!singleViewImage && state.singleViewImage?.trim()) {
        singleViewImage = state.singleViewImage.trim()
      }
      if (!fourViewImage && state.fourViewImage?.trim()) {
        fourViewImage = state.fourViewImage.trim()
      }
      if (!crop && state.crop) {
        crop = state.crop
      }
      if (state.captureMode === '四视角') {
        captureMode = '四视角'
      }
    }

    if (!panoramaImage && !singleViewImage && !fourViewImage && !crop && !captureMode) {
      return undefined
    }

    return {
      panoramaImage,
      singleViewImage,
      fourViewImage,
      crop,
      captureMode
    }
  }

  function resolveEnvironmentHistoryImageByView(
    asset: EnvironmentAssetCard | null | undefined,
    viewMode: EnvironmentCropCaptureMode
  ): string | undefined {
    if (!asset) return undefined
    return resolveEnvironmentViewImageForCard(asset, viewMode)
  }

  function setEnvironmentPanoramaState(
    assetId: string,
    state: EnvironmentPanoramaState | undefined
  ) {
    const aliasKeys = resolveEnvironmentPanoramaStateAliasKeys(assetId)
    const panoramaImage = state?.panoramaImage?.trim() || undefined
    const singleViewImage = state?.singleViewImage?.trim() || undefined
    const fourViewImage = state?.fourViewImage?.trim() || undefined
    const captureMode = state?.captureMode === '四视角' ? '四视角' : undefined
    const hasPayload = !!panoramaImage || !!singleViewImage || !!fourViewImage || !!state?.crop || !!captureMode
    const nextStates = { ...environmentPanoramaStates.value }

    if (!hasPayload) {
      const aliasSet = new Set(aliasKeys)
      const remainingEntries = Object.entries(nextStates)
        .filter(([key]) => !aliasSet.has(key))
      if (remainingEntries.length === Object.keys(nextStates).length) return
      environmentPanoramaStates.value = Object.fromEntries(remainingEntries)
      return
    }

    for (const key of aliasKeys) {
      nextStates[key] = {
        panoramaImage,
        singleViewImage,
        fourViewImage,
        crop: state?.crop,
        captureMode
      }
    }
    environmentPanoramaStates.value = nextStates
  }

  function buildEnvironmentCropUploadPrefix(assetId: string): string {
    const normalized = assetId
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(-48)
    return `env_crop_${normalized || 'asset'}`
  }

  function resolveSceneBaselineReferenceImage(scene: SceneData): string | undefined {
    const assetId = resolveSceneEnvironmentReferenceAssetId(scene)
    const environmentCard = resolveEnvironmentCard(assetId)
    const panoramaState = resolveEnvironmentPanoramaStateForScene(scene)
    const referenceState = {
      panoramaImage: panoramaState?.panoramaImage || environmentCard?.panoramaImage,
      captureMode: panoramaState?.captureMode || environmentCard?.captureMode,
      singleViewImage: panoramaState?.singleViewImage
        || environmentCard?.singleViewImage
        || resolveEnvironmentHistoryImageByView(environmentCard, '单视角'),
      fourViewImage: panoramaState?.fourViewImage
        || environmentCard?.fourViewImage
        || resolveEnvironmentHistoryImageByView(environmentCard, '四视角')
    }
    return resolveEnvironmentReferenceImageForScene(scene, referenceState)
      || resolveSceneReferenceImage(scene)
      || environmentCard?.referenceImage?.trim()
      || scene.firstFrame
  }

  function resolveSceneEnvironmentReferenceImageForMode(
    scene: SceneData,
    mode: EnvironmentCropCaptureMode
  ): string | undefined {
    const assetId = resolveSceneEnvironmentReferenceAssetId(scene)
    const environmentCard = resolveEnvironmentCard(assetId)
    const panoramaState = resolveEnvironmentPanoramaStateForScene(scene)
    const referenceState = {
      panoramaImage: panoramaState?.panoramaImage || environmentCard?.panoramaImage,
      captureMode: panoramaState?.captureMode || environmentCard?.captureMode,
      singleViewImage: panoramaState?.singleViewImage
        || environmentCard?.singleViewImage
        || resolveEnvironmentHistoryImageByView(environmentCard, '单视角'),
      fourViewImage: panoramaState?.fourViewImage
        || environmentCard?.fourViewImage
        || resolveEnvironmentHistoryImageByView(environmentCard, '四视角')
    }
    return resolveEnvironmentReferenceImageByCaptureMode(referenceState, mode)
      || resolveSceneReferenceImage(scene)
      || environmentCard?.referenceImage?.trim()
      || scene.firstFrame?.trim()
  }

  async function createEnvironmentCropImage(options: {
    assetId: string
    sourceImage: string
    crop?: EnvironmentCropSelection
    captureMode?: EnvironmentCropCaptureMode
    aspectRatio?: string
  }) {
    const outputAspectRatio = options.aspectRatio || referenceAspectRatio
    const sourceAspectRatio = panoramaSourceAspectRatio.value
    const captureMode = resolveEnvironmentCropCaptureMode(options.captureMode)
    const metrics = await loadCropImageMetrics(options.sourceImage, {
      sourceAspectRatio
    })
    const fallbackCrop = options.crop || buildDefaultCropSelection({
      imageWidth: metrics.width,
      imageHeight: metrics.height,
      outputAspectRatio
    })
    const crop = normalizePanoramaSelectionForAspectRatio(
      fallbackCrop,
      metrics.width,
      metrics.height,
      outputAspectRatio
    )
    if (!crop) {
      throw new Error('取景区域无效，无法生成环境图')
    }
    const singleViewResult = await renderPanoramaSelectionToDataUrl({
      sourceImage: options.sourceImage,
      selection: crop,
      sourceAspectRatio,
      aspectRatio: outputAspectRatio
    })
    const fourViewResult = await renderPanoramaFourViewToDataUrl({
      sourceImage: options.sourceImage,
      selection: crop,
      sourceAspectRatio,
      aspectRatio: outputAspectRatio
    })
    const normalizedCrop = singleViewResult.crop
    const uploadPrefix = buildEnvironmentCropUploadPrefix(options.assetId)
    const singleViewImage = await uploadAssetImage(singleViewResult.imageData, `${uploadPrefix}_single`, projectId.value || '')
    const fourViewImage = await uploadAssetImage(fourViewResult.imageData, `${uploadPrefix}_four`, projectId.value || '')
    const imageUrl = captureMode === '四视角' ? fourViewImage : singleViewImage

    return {
      imageUrl,
      crop: normalizedCrop,
      captureMode,
      singleViewImage,
      fourViewImage
    }
  }

  async function applyEnvironmentReferenceImage(
    assetId: string,
    imageUrl: string,
    panoramaState?: EnvironmentPanoramaState
  ) {
    const environmentAsset = resolveEnvironmentCard(assetId)
    if (!environmentAsset) return

    for (const sceneId of environmentAsset.sceneIds) {
      const scene = scenes.value.find(item => item.id === sceneId)
      if (!scene) continue

      const sceneReferenceImage = resolveEnvironmentReferenceImageForScene(
        scene,
        panoramaState || resolveEnvironmentPanoramaState(assetId) || environmentAsset
      ) || imageUrl

      applySceneBaselineReference(scene, sceneReferenceImage)
    }

    if (panoramaState !== undefined) {
      setEnvironmentPanoramaState(assetId, panoramaState)
    }

    synchronizeQueueItems()
    await saveProject()
  }

  return {
    resolveEnvironmentPanoramaState,
    resolveEnvironmentHistoryImageByView,
    setEnvironmentPanoramaState,
    resolveSceneBaselineReferenceImage,
    resolveSceneEnvironmentReferenceImageForMode,
    createEnvironmentCropImage,
    applyEnvironmentReferenceImage
  }
}
