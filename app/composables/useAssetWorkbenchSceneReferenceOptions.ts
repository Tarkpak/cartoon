import { computed, type ComputedRef, type Ref } from 'vue'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type { EnvironmentAssetCard } from '~/lib/asset-workbench-types'
import { resolveSceneEnvironmentAssetId } from '~/lib/asset-workbench-environment'
import { isNarrationVoiceAsset } from '~/lib/asset-workbench-scene-references'

interface SceneNarrationVoiceOption {
  assetId: string
  name: string
  locked: boolean
  source: 'manual' | 'auto'
}

/** Options and current selections for a scene's environment and narration-voice pickers. */
export function useAssetWorkbenchSceneReferenceOptions(options: {
  scenes: Ref<SceneData[]>
  sceneConfigs: Ref<Record<string, SceneConsistencyConfig>>
  propAssets: Ref<PropAsset[]>
  displayEnvironmentAssetCards: ComputedRef<EnvironmentAssetCard[]>
  resolveEnvironmentCard: (assetId: string) => EnvironmentAssetCard | undefined
  resolveEnvironmentAssetReferenceImage: (assetId: string) => string | undefined
}) {
  const {
    scenes,
    sceneConfigs,
    propAssets,
    displayEnvironmentAssetCards,
    resolveEnvironmentCard,
    resolveEnvironmentAssetReferenceImage
  } = options

  const sceneEnvironmentAssetOptions = computed<Array<{
    id: string
    label: string
    hasReference: boolean
    previewImage?: string
  }>>(() => {
    return displayEnvironmentAssetCards.value.map(asset => ({
      id: asset.id,
      label: asset.name,
      hasReference: !!resolveEnvironmentAssetReferenceImage(asset.id),
      previewImage: resolveEnvironmentAssetReferenceImage(asset.id)
    }))
  })

  function resolveSceneEnvironmentReferenceAssetSelection(sceneId: string): string {
    const scene = scenes.value.find(item => item.id === sceneId)
    if (!scene) return '__auto__'

    const configuredAssetId = sceneConfigs.value[sceneId]?.environmentAssetId?.trim() || ''
    const configuredAsset = configuredAssetId
      ? resolveEnvironmentCard(configuredAssetId)
      : undefined
    if (configuredAsset) return configuredAsset.id

    const defaultAssetId = resolveSceneEnvironmentAssetId(scene)
    const defaultAsset = resolveEnvironmentCard(defaultAssetId)
    if (defaultAsset) return defaultAsset.id

    return '__auto__'
  }

  function resolveSceneNarrationVoiceOptions(scene: SceneData): SceneNarrationVoiceOption[] {
    if (!scene.narration?.trim()) return []

    return propAssets.value
      .filter(isNarrationVoiceAsset)
      .map((asset) => {
        const isAuto = !!asset.voiceAsset?.sourceSceneId || !!asset.voiceAsset?.sourceTaskId
        return {
          assetId: `prop:${asset.id}`,
          name: asset.name?.trim() || '旁白音色',
          locked: asset.voiceAsset?.locked === true,
          source: isAuto ? 'auto' as const : 'manual' as const
        }
      })
      .sort((left, right) => {
        if (left.locked !== right.locked) return left.locked ? -1 : 1
        return left.name.localeCompare(right.name, 'zh-CN')
      })
  }

  function resolveSceneNarrationVoiceReferenceSelection(sceneId: string): string {
    const scene = scenes.value.find(item => item.id === sceneId)
    if (!scene?.narration?.trim()) return '__auto__'

    const options = resolveSceneNarrationVoiceOptions(scene)
    if (options.length === 0) return '__auto__'
    const optionIdSet = new Set(options.map(item => item.assetId))
    const configuredRefs = sceneConfigs.value[sceneId]?.mustReferenceAssetIds || []
    const explicitSelection = configuredRefs.find(assetId => optionIdSet.has(assetId))
    return explicitSelection || '__auto__'
  }

  return {
    sceneEnvironmentAssetOptions,
    resolveSceneEnvironmentReferenceAssetSelection,
    resolveSceneNarrationVoiceOptions,
    resolveSceneNarrationVoiceReferenceSelection
  }
}
