import { ref, type ComputedRef, type Ref } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'
import type { DisplayAsset, FinalVideoAsset, QueueItem } from '~/lib/asset-workbench-types'
import { createPropAssetId } from '~/lib/asset-workbench-types'
import { uniqueSorted } from '~/lib/asset-workbench-strings'
import { applyAutomaticAssetPlan as buildAutomaticAssetPlan } from '~/lib/asset-workbench-auto-plan'
import { resolveSceneEnvironmentAssetId } from '~/lib/asset-workbench-environment'

/**
 * Automatic asset plan: after parsing, derive props/narration voice from the
 * episode plan and scenes, wire scene references to assets, and persist it.
 * Also resets parsed state when the episode plan is rebuilt.
 */
export function useAssetWorkbenchAutoAssetPlan(options: {
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  propAssets: Ref<PropAsset[]>
  environmentAssets: ComputedRef<DisplayAsset[]>
  episodePlan: Ref<ScriptEpisodePlanItem[]>
  sceneConfigs: Ref<Record<string, SceneConsistencyConfig>>
  queueItems: Ref<QueueItem[]>
  finalVideo: Ref<FinalVideoAsset | null>
  selectedSceneId: Ref<string>
  workflowMetaReady: Ref<boolean>
  hydratingWorkflowMeta: Ref<boolean>
  ensureSceneConfig: (sceneId: string) => SceneConsistencyConfig
  prepareEpisodePlan: () => Promise<boolean>
  saveProject: () => Promise<unknown>
  saveWorkflowMeta: () => Promise<unknown>
  synchronizeQueueItems: () => void
  synchronizeSceneDescriptionsWithAssetMentions: () => boolean
  invalidateSceneGenerations: (sceneIds: string[]) => boolean
  resolveSceneConfigGenerationKey: (config?: SceneConsistencyConfig) => string
}) {
  const {
    scenes,
    characters,
    propAssets,
    environmentAssets,
    episodePlan,
    sceneConfigs,
    queueItems,
    finalVideo,
    selectedSceneId,
    workflowMetaReady,
    hydratingWorkflowMeta,
    ensureSceneConfig,
    prepareEpisodePlan,
    saveProject,
    saveWorkflowMeta,
    synchronizeQueueItems,
    synchronizeSceneDescriptionsWithAssetMentions,
    invalidateSceneGenerations,
    resolveSceneConfigGenerationKey
  } = options

  const lastAutoPlanSnapshotKey = ref('')

  function buildAutoPlanSnapshotKey(): string {
    const sceneSnapshot = scenes.value.map(scene => ({
      id: scene.id,
      episodeId: scene.episodeId || '',
      episodeTitle: scene.episodeTitle || '',
      episodeIndex: typeof scene.episodeIndex === 'number' && Number.isFinite(scene.episodeIndex)
        ? scene.episodeIndex
        : null,
      title: scene.title || '',
      description: scene.description || '',
      narration: scene.narration || '',
      setting: {
        location: scene.setting?.location || '',
        timeOfDay: scene.setting?.timeOfDay || '',
        era: scene.setting?.era || '',
        mood: scene.setting?.mood || '',
        weather: scene.setting?.weather || ''
      },
      characters: scene.characters.map(character => ({
        name: character.name || '',
        assetId: character.assetId || '',
        appearance: character.appearance || '',
        emotion: character.emotion || ''
      })),
      props: (scene.props || []).map(prop => ({
        name: prop.name || '',
        description: prop.description || ''
      }))
    }))

    const characterSnapshot = characters.value.map(character => ({
      id: character.id,
      parentCharacterId: character.parentCharacterId || '',
      variantName: character.variantName || '',
      name: character.name || '',
      appearance: character.appearance || '',
      role: character.role || ''
    }))

    const propSnapshot = propAssets.value.map(prop => ({
      id: prop.id,
      name: prop.name || '',
      description: prop.description || '',
      category: prop.category || 'prop'
    }))

    const sceneConfigSnapshot = Object.entries(sceneConfigs.value)
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId, 'zh-CN'))
      .map(([sceneId, config]) => ({
        sceneId,
        mustReferenceAssetIds: uniqueSorted(config.mustReferenceAssetIds || []),
        consistencyLevel: config.consistencyLevel,
        continuityNotes: config.continuityNotes?.trim() || '',
        environmentAssetId: config.environmentAssetId?.trim() || ''
      }))

    return JSON.stringify({
      sceneSnapshot,
      characterSnapshot,
      propSnapshot,
      sceneConfigSnapshot
    })
  }

  function normalizeEpisodeAssetMergeKey(value?: string): string {
    return (value || '').trim().toLowerCase().replace(/[\s\r\n\t]+/g, '')
  }

  const NARRATION_VOICE_ASSET_HINT_REGEX = /(旁白|画外音|voiceover|narration|旁白音色)/iu
  const NARRATION_VOICE_PROFILE_REGEX = /(?:音色|声线)\s*[：:]\s*([^，。；;\n）)]+)/iu

  function resolveNarrationVoiceDescriptionFromScenes(): string {
    for (const scene of scenes.value) {
      const narration = scene.narration?.trim() || ''
      if (!narration) continue

      const matchedProfile = narration.match(NARRATION_VOICE_PROFILE_REGEX)?.[1]?.trim() || ''
      if (matchedProfile) {
        return `音色基线：${matchedProfile}`
      }
    }

    return '保持旁白音色一致（可上传旁白参考音频）'
  }

  function resolveNarrationVoiceAsset(): PropAsset | undefined {
    return propAssets.value.find((asset) => {
      if (asset.category !== 'other') return false
      return NARRATION_VOICE_ASSET_HINT_REGEX.test(asset.name || '')
    })
  }

  function ensureNarrationVoiceAssetFromScenes(): { assetChanged: boolean, configChanged: boolean } {
    const narrationSceneIds = scenes.value
      .filter(scene => !!scene.narration?.trim())
      .map(scene => scene.id)
    if (narrationSceneIds.length === 0) {
      return { assetChanged: false, configChanged: false }
    }

    let assetChanged = false
    let configChanged = false
    let narrationAsset = resolveNarrationVoiceAsset()
    const narrationDescription = resolveNarrationVoiceDescriptionFromScenes()

    if (!narrationAsset) {
      narrationAsset = {
        id: createPropAssetId(),
        name: '旁白音色',
        description: narrationDescription,
        category: 'other',
        mediaType: 'voice'
      }
      propAssets.value.push(narrationAsset)
      assetChanged = true
    } else if (!narrationAsset.description?.trim() && narrationDescription) {
      narrationAsset.description = narrationDescription
      assetChanged = true
    }

    if (narrationAsset.mediaType !== 'voice') {
      narrationAsset.mediaType = 'voice'
      assetChanged = true
    }

    const narrationAssetRefId = `prop:${narrationAsset.id}`
    for (const sceneId of narrationSceneIds) {
      const config = ensureSceneConfig(sceneId)
      if (config.mustReferenceAssetIds.includes(narrationAssetRefId)) continue
      config.mustReferenceAssetIds = uniqueSorted([
        ...config.mustReferenceAssetIds,
        narrationAssetRefId
      ])
      configChanged = true
    }

    return { assetChanged, configChanged }
  }

  function mergePropAssetsFromEpisodePlan(): boolean {
    if (episodePlan.value.length === 0) return false

    const existingMap = new Map<string, PropAsset>()
    for (const asset of propAssets.value) {
      const key = normalizeEpisodeAssetMergeKey(asset.name)
      if (!key) continue
      existingMap.set(key, asset)
    }

    let changed = false
    for (const episode of episodePlan.value) {
      for (const item of episode.episodeAssets?.props || []) {
        const name = item.name?.trim() || ''
        if (!name) continue
        const key = normalizeEpisodeAssetMergeKey(name)
        if (!key) continue

        const description = item.description?.trim() || ''
        const existing = existingMap.get(key)
        if (existing) {
          if (description && (!existing.description || description.length > existing.description.length)) {
            existing.description = description
            changed = true
          }
          continue
        }

        const nextAsset: PropAsset = {
          id: createPropAssetId(),
          name,
          description,
          category: 'prop'
        }
        propAssets.value.push(nextAsset)
        existingMap.set(key, nextAsset)
        changed = true
      }
    }

    return changed
  }

  function clearParsedSceneStateForEpisodePlanChange(): boolean {
    const hasParsedSceneState = scenes.value.length > 0
      || queueItems.value.length > 0
      || Object.keys(sceneConfigs.value).length > 0
      || !!finalVideo.value?.videoUrl

    if (!hasParsedSceneState) return false

    scenes.value = []
    selectedSceneId.value = ''
    sceneConfigs.value = {}
    queueItems.value = []
    finalVideo.value = null
    lastAutoPlanSnapshotKey.value = ''
    return true
  }

  async function prepareEpisodePlanWithAssetHydration(): Promise<boolean> {
    const prepared = await prepareEpisodePlan()
    if (!prepared) return false

    const sceneStateCleared = clearParsedSceneStateForEpisodePlanChange()
    const propChanged = mergePropAssetsFromEpisodePlan()
    if (sceneStateCleared) {
      await saveProject()
    }
    if ((propChanged || sceneStateCleared) && workflowMetaReady.value && !hydratingWorkflowMeta.value) {
      await saveWorkflowMeta()
    }

    return true
  }

  function applyAutomaticAssetPlan(
    options: { overwriteExistingConfigs?: boolean } = {}
  ): { characterChanged: boolean, configChanged: boolean, generationInvalidated: boolean } {
    const previousConfigKeys = new Map(
      Object.entries(sceneConfigs.value).map(([sceneId, config]) => [
        sceneId,
        resolveSceneConfigGenerationKey(config)
      ])
    )
    const result = buildAutomaticAssetPlan({
      scenes: scenes.value,
      characters: characters.value,
      sceneConfigs: sceneConfigs.value,
      propAssets: propAssets.value,
      environmentAssetIds: environmentAssets.value.map(asset => asset.id),
      overwriteExistingConfigs: options.overwriteExistingConfigs,
      resolveSceneEnvironmentAssetId
    })

    let generationInvalidated = false
    if (result.configChanged) {
      sceneConfigs.value = result.nextSceneConfigs
      generationInvalidated = invalidateSceneGenerations(
        scenes.value
          .map(scene => scene.id)
          .filter((sceneId) => {
            return previousConfigKeys.get(sceneId)
              !== resolveSceneConfigGenerationKey(result.nextSceneConfigs[sceneId])
          })
      )
      synchronizeQueueItems()
    }

    return {
      characterChanged: result.characterChanged,
      configChanged: result.configChanged,
      generationInvalidated
    }
  }

  async function persistAutomaticAssetPlan(
    options: { overwriteExistingConfigs?: boolean } = {}
  ) {
    const forceRefresh = options.overwriteExistingConfigs === true
    const snapshotKeyBefore = buildAutoPlanSnapshotKey()
    if (!forceRefresh && snapshotKeyBefore === lastAutoPlanSnapshotKey.value) {
      return {
        characterChanged: false,
        configChanged: false,
        generationInvalidated: false,
        descriptionMentionChanged: false,
        skipped: true
      }
    }

    const autoPlanResult = applyAutomaticAssetPlan(options)
    const narrationVoiceAssetSyncResult = ensureNarrationVoiceAssetFromScenes()
    const descriptionMentionChanged = synchronizeSceneDescriptionsWithAssetMentions()

    if (
      autoPlanResult.characterChanged
      || autoPlanResult.generationInvalidated
      || narrationVoiceAssetSyncResult.assetChanged
      || descriptionMentionChanged
    ) {
      await saveProject()
    }
    if (autoPlanResult.configChanged || narrationVoiceAssetSyncResult.configChanged || narrationVoiceAssetSyncResult.assetChanged) {
      await saveWorkflowMeta()
    }

    lastAutoPlanSnapshotKey.value = buildAutoPlanSnapshotKey()

    return {
      characterChanged: autoPlanResult.characterChanged,
      configChanged: autoPlanResult.configChanged || narrationVoiceAssetSyncResult.configChanged || narrationVoiceAssetSyncResult.assetChanged,
      generationInvalidated: autoPlanResult.generationInvalidated,
      descriptionMentionChanged,
      skipped: false
    }
  }

  return {
    clearParsedSceneStateForEpisodePlanChange,
    prepareEpisodePlanWithAssetHydration,
    applyAutomaticAssetPlan,
    persistAutomaticAssetPlan
  }
}
