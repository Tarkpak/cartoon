import type { ComputedRef, Ref } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, PropAssetCategory, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type { DisplayAsset } from '~/lib/asset-workbench-types'
import {
  invalidateSceneGenerationState,
  invalidateSceneVideoState
} from '~/lib/asset-workbench-scenes'

export function useAssetWorkbenchSceneManagement(options: {
  selectedSceneId: Ref<string>
  sceneEditDialogOpen: Ref<boolean>
  editingScene: Ref<SceneData | null>
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  sceneConfigs: Ref<Record<string, SceneConsistencyConfig>>
  propAssets: Ref<PropAsset[]>
  allAssets: ComputedRef<DisplayAsset[]>
  environmentAssets: ComputedRef<DisplayAsset[]>
  uniqueSorted: (values: string[]) => string[]
  normalizeToken: (value?: string) => string
  getValidAssetIdSet: (
    characters: CharacterData[],
    environmentAssetIds: string[],
    propAssets: PropAsset[]
  ) => Set<string>
  findCharacterByAssetRefId: (
    rawCharacterId: string,
    characters: CharacterData[]
  ) => CharacterData | undefined
  resolveSceneDescriptionWithoutAssetMentions: (raw?: string) => string
  updateScene: (scene: Partial<SceneData> & { id: string }) => void
  deleteScene: (scene: SceneData) => void
  splitScene: (sceneIndex: number) => void
  mergeWithNextScene: (sceneIndex: number) => void
  saveProject: () => Promise<unknown>
  saveWorkflowMeta: () => Promise<unknown>
  synchronizeQueueItems: () => void
  createPropAssetId: () => string
  isSceneBusy: (scene: SceneData) => boolean
}) {
  let pendingSceneEditSave: { sceneId: string, sceneChanged: boolean } | null = null

  function hasSceneEditChanged(currentScene: SceneData, nextScene: SceneData): boolean {
    return JSON.stringify({
      title: currentScene.title,
      description: currentScene.description,
      characters: currentScene.characters,
      dialogues: currentScene.dialogues,
      narration: currentScene.narration || '',
      duration: currentScene.duration,
      setting: currentScene.setting || null,
      shotType: currentScene.shotType || null,
      cameraMovement: currentScene.cameraMovement || null,
      cameraNote: currentScene.cameraNote || '',
      environmentCaptureMode: currentScene.environmentCaptureMode || null,
      transitionIn: currentScene.transitionIn || null,
      transitionOut: currentScene.transitionOut || null,
      transitionDuration: currentScene.transitionDuration ?? null
    }) !== JSON.stringify({
      title: nextScene.title,
      description: nextScene.description,
      characters: nextScene.characters,
      dialogues: nextScene.dialogues,
      narration: nextScene.narration || '',
      duration: nextScene.duration,
      setting: nextScene.setting || null,
      shotType: nextScene.shotType || null,
      cameraMovement: nextScene.cameraMovement || null,
      cameraNote: nextScene.cameraNote || '',
      environmentCaptureMode: nextScene.environmentCaptureMode || null,
      transitionIn: nextScene.transitionIn || null,
      transitionOut: nextScene.transitionOut || null,
      transitionDuration: nextScene.transitionDuration ?? null
    })
  }

  function resolveCharacterSceneCount(character: CharacterData): number {
    const target = options.normalizeToken(character.name)
    if (!target) return 0

    return options.scenes.value.filter((scene) => {
      return scene.characters.some((sceneCharacter) => {
        const candidate = options.normalizeToken(sceneCharacter.name)
        if (!candidate) return false
        return candidate === target || candidate.includes(target) || target.includes(candidate)
      })
    }).length
  }

  function resolvePropUsageCount(propId: string): number {
    const targetAssetId = `prop:${propId}`
    return options.scenes.value.filter((scene) => {
      const refs = options.sceneConfigs.value[scene.id]?.mustReferenceAssetIds || []
      return refs.includes(targetAssetId)
    }).length
  }

  function synchronizeSceneConfigs() {
    const nextConfigs: Record<string, SceneConsistencyConfig> = {}

    for (const scene of options.scenes.value) {
      nextConfigs[scene.id] = options.sceneConfigs.value[scene.id] || {
        sceneId: scene.id,
        mustReferenceAssetIds: [],
        consistencyLevel: 'lock',
        continuityNotes: '',
        usePreviousLastFrameAsFirstFrame: false,
        continuityLinkReason: ''
      }
    }

    options.sceneConfigs.value = nextConfigs

    if (!options.selectedSceneId.value && options.scenes.value.length > 0) {
      options.selectedSceneId.value = options.scenes.value[0]?.id || ''
    }

    if (
      options.selectedSceneId.value
      && !options.sceneConfigs.value[options.selectedSceneId.value]
      && options.scenes.value.length > 0
    ) {
      options.selectedSceneId.value = options.scenes.value[0]?.id || ''
    }
  }

  function ensureSceneConfig(sceneId: string): SceneConsistencyConfig {
    if (!options.sceneConfigs.value[sceneId]) {
      options.sceneConfigs.value[sceneId] = {
        sceneId,
        mustReferenceAssetIds: [],
        consistencyLevel: 'lock',
        continuityNotes: '',
        usePreviousLastFrameAsFirstFrame: false,
        continuityLinkReason: ''
      }
    }
    return options.sceneConfigs.value[sceneId]!
  }

  function resolveAssetName(assetId: string): string {
    const asset = options.allAssets.value.find(item => item.id === assetId)
    if (asset?.name) return asset.name

    if (assetId.startsWith('char:')) {
      const rawCharacterId = assetId.slice('char:'.length)
      const matched = options.findCharacterByAssetRefId(rawCharacterId, options.characters.value)
      return matched?.name || '角色'
    }
    if (assetId.startsWith('env:') || assetId.startsWith('scene:')) return '环境'
    if (assetId.startsWith('prop:')) return '道具'

    return assetId
  }

  function resolveSceneReferenceAssetIds(sceneId: string): string[] {
    const config = ensureSceneConfig(sceneId)
    return options.uniqueSorted(config.mustReferenceAssetIds)
  }

  function setSceneAssetReferences(sceneId: string, nextAssetIds: string[]): boolean {
    const config = ensureSceneConfig(sceneId)
    const validAssetIds = options.getValidAssetIdSet(
      options.characters.value,
      options.environmentAssets.value.map(asset => asset.id),
      options.propAssets.value
    )
    const normalized = options.uniqueSorted(nextAssetIds.filter(assetId => validAssetIds.has(assetId)))
    const previous = options.uniqueSorted(config.mustReferenceAssetIds)

    if (previous.join('||') === normalized.join('||')) return false

    config.mustReferenceAssetIds = normalized

    if (config.mustReferenceAssetIds.length === 0 && config.consistencyLevel === 'lock') {
      config.consistencyLevel = 'soft'
    }

    const scene = options.scenes.value.find(item => item.id === sceneId)
    if (scene) {
      invalidateSceneGenerationState(scene)
    }

    return true
  }

  async function setScenePreviousLastFrameReference(sceneId: string, enabled: boolean) {
    const config = ensureSceneConfig(sceneId)
    const sceneIndex = options.scenes.value.findIndex(scene => scene.id === sceneId)
    const normalizedEnabled = sceneIndex > 0 && enabled
    if (config.usePreviousLastFrameAsFirstFrame === normalizedEnabled) return

    config.usePreviousLastFrameAsFirstFrame = normalizedEnabled

    const scene = options.scenes.value[sceneIndex]
    if (scene) {
      invalidateSceneVideoState(scene)
      options.synchronizeQueueItems()
      await options.saveProject()
    }
    await options.saveWorkflowMeta()
  }

  function selectScene(sceneId: string) {
    options.selectedSceneId.value = sceneId
  }

  const sceneEditAssetReferenceOptions = computed<DisplayAsset[]>(() => {
    return options.allAssets.value
  })

  const sceneEditSelectedAssetIds = computed<string[]>(() => {
    if (!options.editingScene.value?.id) return []
    return resolveSceneReferenceAssetIds(options.editingScene.value.id)
  })

  function openSceneEdit(scene: SceneData) {
    options.editingScene.value = {
      ...scene,
      description: options.resolveSceneDescriptionWithoutAssetMentions(scene.description || ''),
      setting: scene.setting
        ? { ...scene.setting }
        : { location: '未知', timeOfDay: '白天' },
      characters: scene.characters.map(char => ({ ...char })),
      dialogues: scene.dialogues.map(dialogue => ({ ...dialogue }))
    }
    options.sceneEditDialogOpen.value = true
  }

  function handleSceneSave(updatedScene: Partial<SceneData> & { id: string }) {
    const currentScene = options.scenes.value.find(scene => scene.id === updatedScene.id)
    const nextScene = currentScene
      ? {
          ...currentScene,
          ...updatedScene
        }
      : null

    pendingSceneEditSave = {
      sceneId: updatedScene.id,
      sceneChanged: !!(currentScene && nextScene && hasSceneEditChanged(currentScene, nextScene))
    }

    options.updateScene(updatedScene)
    options.sceneEditDialogOpen.value = false
    options.editingScene.value = null
  }

  async function handleSceneAssetReferencesSave(payload: { sceneId: string, assetIds: string[] }) {
    const refsChanged = setSceneAssetReferences(payload.sceneId, payload.assetIds)
    const sceneChanged = pendingSceneEditSave?.sceneId === payload.sceneId
      ? pendingSceneEditSave.sceneChanged
      : false

    pendingSceneEditSave = null

    if (!sceneChanged && !refsChanged) return

    await options.saveProject()

    if (refsChanged) {
      await options.saveWorkflowMeta()
    }
  }

  async function handleSplitScene(sceneId: string) {
    const targetIndex = options.scenes.value.findIndex(scene => scene.id === sceneId)
    if (targetIndex < 0) return

    const beforeIds = options.scenes.value.map(scene => scene.id)
    const previousConfig = options.sceneConfigs.value[sceneId]
      ? {
          ...options.sceneConfigs.value[sceneId],
          mustReferenceAssetIds: [...options.sceneConfigs.value[sceneId]!.mustReferenceAssetIds]
        }
      : null

    options.splitScene(targetIndex)

    const afterIds = options.scenes.value.map(scene => scene.id)
    if (afterIds.length !== beforeIds.length + 1) return

    const firstSplitScene = options.scenes.value[targetIndex]
    const secondSplitScene = options.scenes.value[targetIndex + 1]
    if (!firstSplitScene || !secondSplitScene || firstSplitScene.id !== sceneId) return

    if (previousConfig) {
      options.sceneConfigs.value[secondSplitScene.id] = {
        ...previousConfig,
        sceneId: secondSplitScene.id,
        mustReferenceAssetIds: options.uniqueSorted(previousConfig.mustReferenceAssetIds),
        usePreviousLastFrameAsFirstFrame: true
      }
    }

    synchronizeSceneConfigs()
    options.synchronizeQueueItems()
    await options.saveWorkflowMeta()
  }

  function resolveSceneConfigSnapshot(sceneId: string): SceneConsistencyConfig | null {
    const config = options.sceneConfigs.value[sceneId]
    if (!config) return null
    return {
      ...config,
      mustReferenceAssetIds: [...config.mustReferenceAssetIds]
    }
  }

  function canMergeSceneByIndex(sceneIndex: number): boolean {
    const scene = options.scenes.value[sceneIndex]
    const nextScene = options.scenes.value[sceneIndex + 1]
    if (!scene || !nextScene) return false
    const currentEpisodeId = scene.episodeId?.trim() || ''
    const nextEpisodeId = nextScene.episodeId?.trim() || ''
    if (currentEpisodeId && nextEpisodeId && currentEpisodeId !== nextEpisodeId) return false
    return !options.isSceneBusy(scene) && !options.isSceneBusy(nextScene)
  }

  async function handleMergeWithNextScene(sceneId: string) {
    const targetIndex = options.scenes.value.findIndex(scene => scene.id === sceneId)
    if (targetIndex < 0 || targetIndex >= options.scenes.value.length - 1) return
    if (!canMergeSceneByIndex(targetIndex)) return

    const currentScene = options.scenes.value[targetIndex]
    const nextScene = options.scenes.value[targetIndex + 1]
    if (!currentScene || !nextScene) return

    const currentConfig = resolveSceneConfigSnapshot(currentScene.id)
    const nextConfig = resolveSceneConfigSnapshot(nextScene.id)

    options.mergeWithNextScene(targetIndex)

    const mergedScene = options.scenes.value[targetIndex]
    if (!mergedScene || mergedScene.id !== currentScene.id) return

    const mergedAssetIds = options.uniqueSorted([
      ...(currentConfig?.mustReferenceAssetIds || []),
      ...(nextConfig?.mustReferenceAssetIds || [])
    ])
    const mergedNotes = Array.from(new Set([
      currentConfig?.continuityNotes?.trim() || '',
      nextConfig?.continuityNotes?.trim() || ''
    ].filter(Boolean))).join('；')

    if (currentConfig || nextConfig) {
      options.sceneConfigs.value[mergedScene.id] = {
        sceneId: mergedScene.id,
        mustReferenceAssetIds: mergedAssetIds,
        consistencyLevel: mergedAssetIds.length === 0
          ? 'soft'
          : (
              currentConfig?.consistencyLevel === 'lock'
              || nextConfig?.consistencyLevel === 'lock'
                ? 'lock'
                : 'soft'
            ),
        continuityNotes: mergedNotes,
        usePreviousLastFrameAsFirstFrame: currentConfig?.usePreviousLastFrameAsFirstFrame === true,
        continuityLinkReason: currentConfig?.continuityLinkReason?.trim() || nextConfig?.continuityLinkReason?.trim() || ''
      }
    }

    const { [nextScene.id]: _removedConfig, ...remainingConfigs } = options.sceneConfigs.value
    void _removedConfig
    options.sceneConfigs.value = remainingConfigs
    synchronizeSceneConfigs()
    options.synchronizeQueueItems()
    await options.saveWorkflowMeta()
  }

  function handleDeleteScene(scene: SceneData) {
    const beforeLength = options.scenes.value.length
    options.deleteScene(scene)

    if (options.scenes.value.length !== beforeLength) {
      synchronizeSceneConfigs()
      options.synchronizeQueueItems()
    }
  }

  function addPropAsset(payload: { name: string, description?: string, category?: PropAssetCategory }) {
    const name = payload.name.trim()
    const description = payload.description?.trim() || ''
    const category: PropAssetCategory = payload.category === 'other' ? 'other' : 'prop'
    if (!name) return

    options.propAssets.value.push({
      id: options.createPropAssetId(),
      name,
      description,
      category
    })

    void options.saveWorkflowMeta()
  }

  function removePropAsset(propId: string) {
    const fullAssetId = `prop:${propId}`
    const affectedSceneIds = options.scenes.value
      .filter((scene) => {
        const refs = options.sceneConfigs.value[scene.id]?.mustReferenceAssetIds || []
        return refs.includes(fullAssetId)
      })
      .map(scene => scene.id)

    options.propAssets.value = options.propAssets.value.filter(prop => prop.id !== propId)
    for (const config of Object.values(options.sceneConfigs.value)) {
      config.mustReferenceAssetIds = config.mustReferenceAssetIds.filter(assetId => assetId !== fullAssetId)
    }

    const invalidated = affectedSceneIds
      .map(sceneId => options.scenes.value.find(scene => scene.id === sceneId))
      .filter((scene): scene is SceneData => !!scene)
      .some(scene => invalidateSceneGenerationState(scene))

    if (invalidated) {
      options.synchronizeQueueItems()
      void options.saveProject()
    }

    void options.saveWorkflowMeta()
  }

  return {
    resolveCharacterSceneCount,
    resolvePropUsageCount,
    synchronizeSceneConfigs,
    ensureSceneConfig,
    resolveAssetName,
    resolveSceneReferenceAssetIds,
    setSceneAssetReferences,
    setScenePreviousLastFrameReference,
    selectScene,
    sceneEditAssetReferenceOptions,
    sceneEditSelectedAssetIds,
    openSceneEdit,
    handleSceneSave,
    handleSceneAssetReferencesSave,
    handleSplitScene,
    canMergeSceneByIndex,
    handleMergeWithNextScene,
    handleDeleteScene,
    addPropAsset,
    removePropAsset
  }
}
