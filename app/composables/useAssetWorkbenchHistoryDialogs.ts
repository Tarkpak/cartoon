import { computed, ref, type Ref } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import type {
  AssetImageHistoryEntry,
  AssetVideoHistoryEntry,
  EnvironmentAssetCard,
  EnvironmentPanoramaState
} from '~/lib/asset-workbench-types'

type AssetHistoryTarget
  = | { type: 'character', id: string }
    | { type: 'environment', id: string }
    | { type: 'prop', id: string }

type SceneVideoHistoryTarget = { sceneId: string }

/**
 * History dialogs: pick an earlier image of a character/environment/prop
 * asset, or an earlier video of a scene, and make it current again.
 */
export function useAssetWorkbenchHistoryDialogs(options: {
  characters: Ref<CharacterData[]>
  propAssets: Ref<PropAsset[]>
  scenes: Ref<SceneData[]>
  resolveEnvironmentCard: (assetId: string) => EnvironmentAssetCard | undefined
  resolveEnvironmentPanoramaState: (assetId: string) => EnvironmentPanoramaState | undefined
  applyEnvironmentReferenceImage: (assetId: string, imageUrl: string, panoramaState?: EnvironmentPanoramaState) => Promise<void>
  saveProject: () => Promise<unknown>
  saveWorkflowMeta: () => Promise<unknown>
  synchronizeQueueItems: () => void
}) {
  const {
    characters,
    propAssets,
    scenes,
    resolveEnvironmentCard,
    resolveEnvironmentPanoramaState,
    applyEnvironmentReferenceImage,
    saveProject,
    saveWorkflowMeta,
    synchronizeQueueItems
  } = options

  const assetHistoryDialogOpen = ref(false)
  const assetHistoryTarget = ref<AssetHistoryTarget | null>(null)
  const assetHistoryApplying = ref(false)
  const sceneVideoHistoryDialogOpen = ref(false)
  const sceneVideoHistoryTarget = ref<SceneVideoHistoryTarget | null>(null)
  const sceneVideoHistoryApplying = ref(false)

  const assetHistoryDialogTitle = computed(() => {
    if (assetHistoryTarget.value?.type === 'character') return '角色资产历史'
    if (assetHistoryTarget.value?.type === 'environment') return '环境资产历史'
    if (assetHistoryTarget.value?.type === 'prop') return '道具资产历史'
    return '资产历史'
  })

  const assetHistoryTargetType = computed(() => assetHistoryTarget.value?.type || null)

  const assetHistoryTargetLabel = computed(() => {
    if (!assetHistoryTarget.value) return ''

    if (assetHistoryTarget.value.type === 'character') {
      return characters.value.find(item => item.id === assetHistoryTarget.value?.id)?.name || ''
    }

    if (assetHistoryTarget.value.type === 'environment') {
      return resolveEnvironmentCard(assetHistoryTarget.value.id)?.name || ''
    }

    return propAssets.value.find(item => item.id === assetHistoryTarget.value?.id)?.name || ''
  })

  const assetHistoryCurrentImage = computed(() => {
    if (!assetHistoryTarget.value) return ''

    if (assetHistoryTarget.value.type === 'character') {
      return characters.value.find(item => item.id === assetHistoryTarget.value?.id)?.baseImage || ''
    }

    if (assetHistoryTarget.value.type === 'environment') {
      return resolveEnvironmentCard(assetHistoryTarget.value.id)?.referenceImage || ''
    }

    return propAssets.value.find(item => item.id === assetHistoryTarget.value?.id)?.referenceImage || ''
  })

  const assetHistoryEntries = computed(() => {
    if (!assetHistoryTarget.value) return []

    if (assetHistoryTarget.value.type === 'character') {
      return characters.value.find(item => item.id === assetHistoryTarget.value?.id)?.assetHistory || []
    }

    if (assetHistoryTarget.value.type === 'environment') {
      return resolveEnvironmentCard(assetHistoryTarget.value.id)?.assetHistory || []
    }

    return propAssets.value.find(item => item.id === assetHistoryTarget.value?.id)?.assetHistory || []
  })

  const sceneVideoHistoryTargetScene = computed(() => {
    if (!sceneVideoHistoryTarget.value) return null
    return scenes.value.find(item => item.id === sceneVideoHistoryTarget.value?.sceneId) || null
  })

  const sceneVideoHistoryTargetLabel = computed(() => {
    return sceneVideoHistoryTargetScene.value?.title || ''
  })

  const sceneVideoHistoryCurrentVideoUrl = computed(() => {
    return sceneVideoHistoryTargetScene.value?.videoUrl || ''
  })

  const sceneVideoHistoryEntries = computed(() => {
    return sceneVideoHistoryTargetScene.value?.videoHistory || []
  })

  function setAssetHistoryDialogOpen(open: boolean) {
    assetHistoryDialogOpen.value = open
    if (!open) {
      assetHistoryTarget.value = null
    }
  }

  function setSceneVideoHistoryDialogOpen(open: boolean) {
    sceneVideoHistoryDialogOpen.value = open
    if (!open) {
      sceneVideoHistoryTarget.value = null
    }
  }

  function openCharacterHistory(characterId: string) {
    assetHistoryTarget.value = { type: 'character', id: characterId }
    assetHistoryDialogOpen.value = true
  }

  function openEnvironmentHistory(assetId: string) {
    assetHistoryTarget.value = { type: 'environment', id: assetId }
    assetHistoryDialogOpen.value = true
  }

  function openPropHistory(propId: string) {
    assetHistoryTarget.value = { type: 'prop', id: propId }
    assetHistoryDialogOpen.value = true
  }

  function openSceneVideoHistory(sceneId: string) {
    sceneVideoHistoryTarget.value = { sceneId }
    sceneVideoHistoryDialogOpen.value = true
  }

  async function handleAssetHistorySelect(entry: AssetImageHistoryEntry) {
    if (!assetHistoryTarget.value || !entry.image?.trim()) return

    const nextImage = entry.image.trim()
    const target = assetHistoryTarget.value
    assetHistoryApplying.value = true

    try {
      if (target.type === 'character') {
        const character = characters.value.find(item => item.id === target.id)
        if (!character || character.baseImage === nextImage) {
          setAssetHistoryDialogOpen(false)
          return
        }

        character.baseImage = nextImage
        await saveProject()
        setAssetHistoryDialogOpen(false)
        return
      }

      if (target.type === 'environment') {
        const environmentAsset = resolveEnvironmentCard(target.id)
        if (!environmentAsset || environmentAsset.referenceImage === nextImage) {
          setAssetHistoryDialogOpen(false)
          return
        }

        const latestState = resolveEnvironmentPanoramaState(target.id) || environmentAsset
        const nextPanoramaState: EnvironmentPanoramaState = {
          panoramaImage: latestState.panoramaImage?.trim() || undefined,
          crop: latestState.crop
        }

        if (entry.viewMode === '单视角') {
          nextPanoramaState.singleViewImage = nextImage
          nextPanoramaState.fourViewImage = latestState.fourViewImage?.trim() || undefined
        } else if (entry.viewMode === '四视角') {
          nextPanoramaState.singleViewImage = latestState.singleViewImage?.trim() || undefined
          nextPanoramaState.fourViewImage = nextImage
          nextPanoramaState.captureMode = '四视角'
        } else {
          nextPanoramaState.singleViewImage = latestState.singleViewImage?.trim() || undefined
          nextPanoramaState.fourViewImage = latestState.fourViewImage?.trim() || undefined
          if (latestState.captureMode === '四视角') {
            nextPanoramaState.captureMode = '四视角'
          }
        }

        await applyEnvironmentReferenceImage(target.id, nextImage, nextPanoramaState)
        await saveWorkflowMeta()
        setAssetHistoryDialogOpen(false)
        return
      }

      const prop = propAssets.value.find(item => item.id === target.id)
      if (!prop || prop.referenceImage === nextImage) {
        setAssetHistoryDialogOpen(false)
        return
      }

      prop.referenceImage = nextImage
      await saveWorkflowMeta()
      setAssetHistoryDialogOpen(false)
    } finally {
      assetHistoryApplying.value = false
    }
  }

  async function handleSceneVideoHistorySelect(entry: AssetVideoHistoryEntry) {
    const scene = sceneVideoHistoryTargetScene.value
    const nextVideoUrl = entry.videoUrl?.trim()
    if (!scene || !nextVideoUrl) return

    sceneVideoHistoryApplying.value = true

    try {
      if (scene.videoUrl === nextVideoUrl) {
        setSceneVideoHistoryDialogOpen(false)
        return
      }

      scene.videoUrl = nextVideoUrl
      scene.videoError = undefined
      scene.videoStatus = 'done'
      synchronizeQueueItems()
      await saveProject()
      setSceneVideoHistoryDialogOpen(false)
    } finally {
      sceneVideoHistoryApplying.value = false
    }
  }

  return {
    assetHistoryDialogOpen,
    assetHistoryApplying,
    sceneVideoHistoryDialogOpen,
    sceneVideoHistoryApplying,
    assetHistoryDialogTitle,
    assetHistoryTargetType,
    assetHistoryTargetLabel,
    assetHistoryCurrentImage,
    assetHistoryEntries,
    sceneVideoHistoryTargetLabel,
    sceneVideoHistoryCurrentVideoUrl,
    sceneVideoHistoryEntries,
    setAssetHistoryDialogOpen,
    setSceneVideoHistoryDialogOpen,
    openCharacterHistory,
    openEnvironmentHistory,
    openPropHistory,
    openSceneVideoHistory,
    handleAssetHistorySelect,
    handleSceneVideoHistorySelect
  }
}
