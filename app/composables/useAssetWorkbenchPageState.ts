import { computed } from 'vue'
import type { Ref } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'
import {
  buildEnvironmentAssetCards,
  buildEnvironmentDisplayAssets,
  hasEnvironmentRepresentativeScene as hasEnvironmentRepresentativeSceneForAsset,
  resolveEnvironmentCard as findEnvironmentCard,
  resolveEnvironmentRepresentativeScene as findEnvironmentRepresentativeScene,
  resolveEnvironmentSceneSummary,
  resolveSceneEnvironmentAssetId,
  resolveSceneReferenceImage as resolveSceneDirectReferenceImage
} from '~/lib/asset-workbench-environment'
import {
  resolveAssetByMentionTokenMap as createAssetByMentionTokenMap,
  resolveAssetMentionTokenMap as createAssetMentionTokenMap,
  resolveDisplayAssetTypeLabel,
  resolveSceneDescriptionRenderSegments as createSceneDescriptionRenderSegments,
  resolveSceneDescriptionSecondaryMentionItems as createSceneDescriptionSecondaryMentionItems
} from '~/lib/asset-workbench-mentions'
import { resolveSceneVoiceReferenceSummary as createSceneVoiceReferenceSummary } from '~/lib/asset-workbench-voice'
import {
  buildNextQueueItems,
  buildQueueSummary,
  isScenePreparing as resolveScenePreparingState,
  isSceneBusy as resolveSceneBusyState,
  resolveSceneVideoBadge as createSceneVideoBadge
} from '~/lib/asset-workbench-progress'
import type {
  AssetImageHistoryEntry,
  DisplayAsset,
  EnvironmentAssetCard,
  EnvironmentPanoramaState,
  QueueItem,
  SceneDescriptionMentionItem,
  SceneDescriptionRenderSegment
} from '~/lib/asset-workbench-types'

interface UseAssetWorkbenchPageStateOptions {
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  episodePlan: Ref<ScriptEpisodePlanItem[]>
  propAssets: Ref<PropAsset[]>
  environmentAssetHistories: Ref<Record<string, AssetImageHistoryEntry[]>>
  environmentPanoramaStates: Ref<Record<string, EnvironmentPanoramaState>>
  sceneConfigs: Ref<Record<string, SceneConsistencyConfig>>
  selectedSceneId: Ref<string>
  selectedStyleId: Ref<string>
  projectStyleId: Ref<string>
  supportsExplicitVoiceAudioReference: Ref<boolean>
  queueItems: Ref<QueueItem[]>
  resolveStyleById: (styleId: string) => {
    name: string
    prompt: string
  } | null | undefined
  resolveSceneDescriptionWithoutAssetMentions: (raw?: string) => string
  uniqueSorted: (values: string[]) => string[]
}

function normalizeEpisodeAssetKey(value?: string): string {
  return (value || '').trim().toLowerCase()
}

function buildEpisodeEnvironmentHintCards(options: {
  episodes: ScriptEpisodePlanItem[]
  environmentAssetHistories?: Record<string, AssetImageHistoryEntry[]>
  environmentPanoramaStates?: Record<string, EnvironmentPanoramaState>
}): EnvironmentAssetCard[] {
  if (!Array.isArray(options.episodes) || options.episodes.length === 0) return []

  const merged = new Map<string, EnvironmentAssetCard>()

  for (const episode of options.episodes) {
    const episodeLabel = (episode.title?.trim() || '').trim()
      || (Number.isFinite(episode.index) ? `第${episode.index}集` : '目录候选')
    const episodeMarkerId = episode.id?.trim() || `plan_${episode.index || 'episode'}`

    for (const item of episode.episodeAssets?.environments || []) {
      const location = item.location?.trim() || ''
      const timeOfDay = item.timeOfDay?.trim() || ''
      const mood = item.mood?.trim() || ''
      if (!location) continue

      const assetId = `env:${normalizeEpisodeAssetKey(location)}||${normalizeEpisodeAssetKey(timeOfDay)}`
      if (!assetId.trim()) continue

      const history = options.environmentAssetHistories?.[assetId] || []
      const panoramaImage = options.environmentPanoramaStates?.[assetId]?.panoramaImage?.trim() || ''
      const referenceImage = panoramaImage || history[0]?.image || undefined
      const existing = merged.get(assetId)
      if (existing) {
        if (mood && (!existing.description || mood.length > existing.description.length)) {
          existing.description = mood
        }
        if (!existing.referenceImage && referenceImage) {
          existing.referenceImage = referenceImage
        }
        if (!existing.panoramaImage && panoramaImage) {
          existing.panoramaImage = panoramaImage
        }
        if ((!existing.assetHistory || existing.assetHistory.length === 0) && history.length > 0) {
          existing.assetHistory = history
        }
        const marker = `${episodeLabel}（目录）`
        if (!existing.sceneTitles.includes(marker)) {
          existing.sceneTitles.push(marker)
        }
        const markerId = `plan:${episodeMarkerId}`
        if (!existing.sceneIds.includes(markerId)) {
          existing.sceneIds.push(markerId)
        }
        continue
      }

      const nameParts = [location, timeOfDay].filter(Boolean)
      merged.set(assetId, {
        id: assetId,
        name: nameParts.length > 0 ? nameParts.join(' / ') : location,
        description: mood || undefined,
        referenceImage,
        referenceError: undefined,
        panoramaImage: panoramaImage || undefined,
        crop: undefined,
        assetHistory: history,
        sceneIds: [`plan:${episodeMarkerId}`],
        sceneTitles: [`${episodeLabel}（目录）`],
        representativeSceneId: '',
        referenceStatus: 'pending'
      })
    }
  }

  return Array.from(merged.values())
}

export function useAssetWorkbenchPageState(options: UseAssetWorkbenchPageStateOptions) {
  const selectedScene = computed<SceneData | null>(() => {
    if (options.scenes.value.length === 0) return null

    const matched = options.scenes.value.find(scene => scene.id === options.selectedSceneId.value)
    if (matched) return matched

    return options.scenes.value[0] || null
  })

  const characterAssets = computed<DisplayAsset[]>(() => {
    return options.characters.value.map(char => ({
      id: `char:${char.id}`,
      name: char.name,
      type: 'character' as const,
      description: char.appearance,
      referenceImage: char.baseImage,
      assetHistory: char.assetHistory
    }))
  })

  const environmentAssetCards = computed(() => {
    const sceneDerivedCards = buildEnvironmentAssetCards({
      scenes: options.scenes.value,
      environmentAssetHistories: options.environmentAssetHistories.value,
      environmentPanoramaStates: options.environmentPanoramaStates.value,
      resolveSceneDescriptionWithoutAssetMentions: options.resolveSceneDescriptionWithoutAssetMentions
    })
    const episodeHintCards = buildEpisodeEnvironmentHintCards({
      episodes: options.episodePlan.value,
      environmentAssetHistories: options.environmentAssetHistories.value,
      environmentPanoramaStates: options.environmentPanoramaStates.value
    })
    if (episodeHintCards.length === 0) return sceneDerivedCards

    const merged = new Map(sceneDerivedCards.map(card => [card.id, card]))
    for (const hintCard of episodeHintCards) {
      const existing = merged.get(hintCard.id)
      if (!existing) {
        merged.set(hintCard.id, hintCard)
        continue
      }
      if (!existing.description && hintCard.description) {
        existing.description = hintCard.description
      }
    }

    return Array.from(merged.values())
  })

  const environmentAssets = computed<DisplayAsset[]>(() => {
    return buildEnvironmentDisplayAssets(environmentAssetCards.value)
  })

  const propDisplayAssets = computed<DisplayAsset[]>(() => {
    return options.propAssets.value.map(prop => ({
      id: `prop:${prop.id}`,
      name: prop.name,
      type: prop.category === 'other' ? 'other' as const : 'prop' as const,
      description: prop.description,
      referenceImage: prop.referenceImage,
      assetHistory: prop.assetHistory
    }))
  })

  const allAssets = computed<DisplayAsset[]>(() => {
    return [
      ...characterAssets.value,
      ...environmentAssets.value,
      ...propDisplayAssets.value
    ]
  })

  const workflowStylePrompt = computed(() => {
    const styleId = options.selectedStyleId.value || options.projectStyleId.value
    if (!styleId) return ''

    const style = options.resolveStyleById(styleId)
    if (!style) return styleId

    return `${style.name}, ${style.prompt} style`
  })

  const queueSummary = computed(() => {
    return buildQueueSummary(options.queueItems.value)
  })

  const assetsReady = computed(() => {
    if (options.characters.value.length === 0) return true
    return options.characters.value.every(character => !!character.baseImage)
  })

  const characterReadyCount = computed(() => {
    return options.characters.value.filter(char => !!char.baseImage).length
  })

  const characterGeneratingCount = computed(() => {
    return options.characters.value.filter(char => !!char.generating).length
  })

  const characterMissingCount = computed(() => {
    return Math.max(
      options.characters.value.length - characterReadyCount.value - characterGeneratingCount.value,
      0
    )
  })

  const assetsAllReady = computed(() => {
    if (options.characters.value.length === 0) return true
    return characterMissingCount.value === 0 && characterGeneratingCount.value === 0
  })

  const assetsPrimaryActionLabel = computed(() => {
    return assetsAllReady.value ? '检查资产状态' : '自动补齐缺失资产'
  })

  function resolveAssetMentionTokenMap(): Map<string, string> {
    return createAssetMentionTokenMap(allAssets.value)
  }

  function resolveAssetByMentionTokenMap(): Map<string, DisplayAsset> {
    return createAssetByMentionTokenMap(allAssets.value)
  }

  function resolveSceneDescriptionSecondaryMentionItems(scene: SceneData): SceneDescriptionMentionItem[] {
    return createSceneDescriptionSecondaryMentionItems({
      scene,
      assets: allAssets.value,
      configAssetIds: options.sceneConfigs.value[scene.id]?.mustReferenceAssetIds,
      uniqueSorted: options.uniqueSorted
    })
  }

  function resolveSceneDescriptionRenderSegments(scene: SceneData): SceneDescriptionRenderSegment[] {
    return createSceneDescriptionRenderSegments({
      scene,
      assets: allAssets.value,
      configAssetIds: options.sceneConfigs.value[scene.id]?.mustReferenceAssetIds,
      uniqueSorted: options.uniqueSorted
    })
  }

  function resolveDisplayAssetById(assetId: string): DisplayAsset | undefined {
    return allAssets.value.find(asset => asset.id === assetId)
  }

  function resolveSceneReferenceImage(scene: SceneData): string | undefined {
    const environmentAssetId = resolveSceneEnvironmentAssetId(scene)
    return findEnvironmentCard(environmentAssetId, environmentAssetCards.value)?.referenceImage
      || resolveSceneDirectReferenceImage(scene)
  }

  function synchronizeQueueItems() {
    options.queueItems.value = buildNextQueueItems(options.scenes.value, options.queueItems.value)
  }

  function isSceneBusy(scene: SceneData): boolean {
    return resolveSceneBusyState(scene, options.queueItems.value)
  }

  function isScenePreparing(scene: SceneData): boolean {
    return resolveScenePreparingState(scene, options.queueItems.value)
  }

  function resolveSceneVideoBadge(scene: SceneData) {
    return createSceneVideoBadge(scene, options.queueItems.value)
  }

  function resolveSceneVoiceReferenceSummary(scene: SceneData) {
    return createSceneVoiceReferenceSummary({
      scene,
      characters: options.characters.value,
      supportsExplicitAudioReference: options.supportsExplicitVoiceAudioReference.value
    })
  }

  function resolveEnvironmentCard(assetId: string) {
    return findEnvironmentCard(assetId, environmentAssetCards.value)
  }

  function resolveEnvironmentRepresentativeScene(assetId: string) {
    return findEnvironmentRepresentativeScene(assetId, environmentAssetCards.value, options.scenes.value)
  }

  function hasEnvironmentRepresentativeScene(assetId: string): boolean {
    return hasEnvironmentRepresentativeSceneForAsset(
      assetId,
      environmentAssetCards.value,
      options.scenes.value
    )
  }

  return {
    selectedScene,
    characterAssets,
    environmentAssetCards,
    environmentAssets,
    propDisplayAssets,
    allAssets,
    workflowStylePrompt,
    queueSummary,
    assetsReady,
    characterReadyCount,
    characterGeneratingCount,
    characterMissingCount,
    assetsAllReady,
    assetsPrimaryActionLabel,
    resolveDisplayAssetTypeLabel,
    resolveEnvironmentSceneSummary,
    resolveSceneReferenceImage,
    resolveAssetMentionTokenMap,
    resolveAssetByMentionTokenMap,
    resolveSceneDescriptionSecondaryMentionItems,
    resolveSceneDescriptionRenderSegments,
    resolveDisplayAssetById,
    synchronizeQueueItems,
    isSceneBusy,
    isScenePreparing,
    resolveSceneVideoBadge,
    resolveSceneVoiceReferenceSummary,
    resolveEnvironmentCard,
    resolveEnvironmentRepresentativeScene,
    hasEnvironmentRepresentativeScene
  }
}
