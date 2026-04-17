import type { ComputedRef, Ref } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type { DisplayAsset } from '~/lib/asset-workbench-types'

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
  saveWorkflowMeta: () => Promise<unknown>
  synchronizeQueueItems: () => void
  createPropAssetId: () => string
  isSceneBusy: (scene: SceneData) => boolean
}) {
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
        continuityNotes: ''
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
        continuityNotes: ''
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

  function setSceneAssetReferences(sceneId: string, nextAssetIds: string[]) {
    const config = ensureSceneConfig(sceneId)
    const validAssetIds = options.getValidAssetIdSet(
      options.characters.value,
      options.environmentAssets.value.map(asset => asset.id),
      options.propAssets.value
    )
    const normalized = options.uniqueSorted(nextAssetIds.filter(assetId => validAssetIds.has(assetId)))
    const previous = options.uniqueSorted(config.mustReferenceAssetIds)

    if (previous.join('||') === normalized.join('||')) return

    config.mustReferenceAssetIds = normalized

    if (config.mustReferenceAssetIds.length === 0 && config.consistencyLevel === 'lock') {
      config.consistencyLevel = 'soft'
    }

    const scene = options.scenes.value.find(item => item.id === sceneId)
    if (scene && scene.videoStatus === 'done') {
      scene.videoStatus = 'pending'
      scene.videoError = undefined
      scene.videoUrl = undefined
    }
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
        : { location: '未知', timeOfDay: 'morning' },
      characters: scene.characters.map(char => ({ ...char })),
      dialogues: scene.dialogues.map(dialogue => ({ ...dialogue }))
    }
    options.sceneEditDialogOpen.value = true
  }

  function handleSceneSave(updatedScene: Partial<SceneData> & { id: string }) {
    options.updateScene(updatedScene)
    options.sceneEditDialogOpen.value = false
    options.editingScene.value = null
  }

  function handleSceneAssetReferencesSave(payload: { sceneId: string, assetIds: string[] }) {
    setSceneAssetReferences(payload.sceneId, payload.assetIds)
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
        mustReferenceAssetIds: options.uniqueSorted(previousConfig.mustReferenceAssetIds)
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
        continuityNotes: mergedNotes
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

  function addPropAsset(payload: { name: string, description?: string }) {
    const name = payload.name.trim()
    const description = payload.description?.trim() || ''
    if (!name) return

    options.propAssets.value.push({
      id: options.createPropAssetId(),
      name,
      description
    })
  }

  function removePropAsset(propId: string) {
    options.propAssets.value = options.propAssets.value.filter(prop => prop.id !== propId)

    const fullAssetId = `prop:${propId}`
    for (const config of Object.values(options.sceneConfigs.value)) {
      config.mustReferenceAssetIds = config.mustReferenceAssetIds.filter(assetId => assetId !== fullAssetId)
    }
  }

  return {
    resolveCharacterSceneCount,
    resolvePropUsageCount,
    synchronizeSceneConfigs,
    ensureSceneConfig,
    resolveAssetName,
    resolveSceneReferenceAssetIds,
    setSceneAssetReferences,
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
