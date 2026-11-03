import { useDebounceFn } from '@vueuse/core'
import { watch, type Ref } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import { resolveCharacterRefsFromScene } from '~/lib/asset-workbench-reference-detection'
import {
  invalidateSceneGenerationState,
  invalidateSceneVideoState
} from '~/lib/asset-workbench-scenes'

interface CharacterDependencySnapshot {
  id: string
  name: string
  baseImage: string
}

interface PropDependencySnapshot {
  id: string
  name: string
  referenceImage: string
}

/**
 * Keeps generated scenes consistent with the assets they reference: renaming a
 * character/prop invalidates the scene's generated description state, and a
 * new reference image invalidates its video.
 */
export function useAssetWorkbenchDependencyInvalidation(options: {
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  propAssets: Ref<PropAsset[]>
  sceneConfigs: Ref<Record<string, SceneConsistencyConfig>>
  workflowMetaReady: Ref<boolean>
  hydratingWorkflowMeta: Ref<boolean>
  synchronizeQueueItems: () => void
  saveProject: () => Promise<unknown>
}) {
  const {
    scenes,
    characters,
    propAssets,
    sceneConfigs,
    workflowMetaReady,
    hydratingWorkflowMeta,
    synchronizeQueueItems,
    saveProject
  } = options

  function resolveScenesReferencingAsset(assetId: string): string[] {
    return scenes.value
      .filter((scene) => {
        const refs = sceneConfigs.value[scene.id]?.mustReferenceAssetIds || []
        return refs.includes(assetId)
      })
      .map(scene => scene.id)
  }

  function resolveCharacterDependentSceneIds(characterId: string): string[] {
    const targetRef = `char:${characterId}`
    const dependentSceneIds = new Set<string>()

    for (const scene of scenes.value) {
      const configuredRefs = sceneConfigs.value[scene.id]?.mustReferenceAssetIds || []
      if (configuredRefs.includes(targetRef)) {
        dependentSceneIds.add(scene.id)
        continue
      }

      const { refs } = resolveCharacterRefsFromScene({
        scene,
        characters: characters.value
      })
      if (refs.includes(targetRef)) {
        dependentSceneIds.add(scene.id)
      }
    }

    return Array.from(dependentSceneIds)
  }

  function invalidateSceneGenerations(sceneIds: string[]): boolean {
    const targetIds = new Set(sceneIds)
    let changed = false

    for (const scene of scenes.value) {
      if (!targetIds.has(scene.id)) continue
      changed = invalidateSceneGenerationState(scene) || changed
    }

    return changed
  }

  function invalidateSceneVideos(sceneIds: string[]): boolean {
    const targetIds = new Set(sceneIds)
    let changed = false

    for (const scene of scenes.value) {
      if (!targetIds.has(scene.id)) continue
      changed = invalidateSceneVideoState(scene) || changed
    }

    return changed
  }

  function buildCharacterDependencySnapshot(): CharacterDependencySnapshot[] {
    return characters.value.map(character => ({
      id: character.id,
      name: character.name.trim(),
      baseImage: character.baseImage?.trim() || ''
    }))
  }

  function buildPropDependencySnapshot(): PropDependencySnapshot[] {
    return propAssets.value.map(prop => ({
      id: prop.id,
      name: prop.name.trim(),
      referenceImage: prop.referenceImage?.trim() || ''
    }))
  }

  let previousCharacterDependencySnapshot = buildCharacterDependencySnapshot()

  watch(
    buildCharacterDependencySnapshot,
    async (nextSnapshot) => {
      const clonedSnapshot = nextSnapshot.map(item => ({ ...item }))
      if (!workflowMetaReady.value || hydratingWorkflowMeta.value) {
        previousCharacterDependencySnapshot = clonedSnapshot
        return
      }

      const previousMap = new Map(
        previousCharacterDependencySnapshot.map(item => [item.id, item])
      )
      previousCharacterDependencySnapshot = clonedSnapshot

      const generationSceneIds = new Set<string>()
      const videoSceneIds = new Set<string>()

      for (const character of clonedSnapshot) {
        const previous = previousMap.get(character.id)
        if (!previous) continue

        const nameChanged = previous.name !== character.name
        const baseImageChanged = previous.baseImage !== character.baseImage
        if (!nameChanged && !baseImageChanged) continue

        const sceneIds = resolveCharacterDependentSceneIds(character.id)
        for (const sceneId of sceneIds) {
          if (nameChanged) {
            generationSceneIds.add(sceneId)
            continue
          }
          if (baseImageChanged) {
            videoSceneIds.add(sceneId)
          }
        }
      }

      const generationInvalidated = invalidateSceneGenerations(Array.from(generationSceneIds))
      const videoInvalidated = invalidateSceneVideos(
        Array.from(videoSceneIds).filter(sceneId => !generationSceneIds.has(sceneId))
      )

      if (!generationInvalidated && !videoInvalidated) return

      synchronizeQueueItems()
      await saveProject()
    }
  )

  let previousPropDependencySnapshot = buildPropDependencySnapshot()

  const processPropDependencyChanges = useDebounceFn(async (nextSnapshot: PropDependencySnapshot[]) => {
    const previousMap = new Map(
      previousPropDependencySnapshot.map(item => [item.id, item])
    )
    previousPropDependencySnapshot = nextSnapshot

    if (!workflowMetaReady.value || hydratingWorkflowMeta.value) {
      return
    }

    const generationSceneIds = new Set<string>()
    const videoSceneIds = new Set<string>()

    for (const prop of nextSnapshot) {
      const previous = previousMap.get(prop.id)
      if (!previous) continue

      const nameChanged = previous.name !== prop.name
      const referenceImageChanged = previous.referenceImage !== prop.referenceImage
      if (!nameChanged && !referenceImageChanged) continue

      const sceneIds = resolveScenesReferencingAsset(`prop:${prop.id}`)
      for (const sceneId of sceneIds) {
        if (nameChanged) {
          generationSceneIds.add(sceneId)
          continue
        }
        if (referenceImageChanged) {
          videoSceneIds.add(sceneId)
        }
      }
    }

    const generationInvalidated = invalidateSceneGenerations(Array.from(generationSceneIds))
    const videoInvalidated = invalidateSceneVideos(
      Array.from(videoSceneIds).filter(sceneId => !generationSceneIds.has(sceneId))
    )

    if (!generationInvalidated && !videoInvalidated) return

    synchronizeQueueItems()
    await saveProject()
  }, 500)

  watch(
    buildPropDependencySnapshot,
    (nextSnapshot) => {
      const clonedSnapshot = nextSnapshot.map(item => ({ ...item }))
      if (!workflowMetaReady.value || hydratingWorkflowMeta.value) {
        previousPropDependencySnapshot = clonedSnapshot
        return
      }

      void processPropDependencyChanges(clonedSnapshot)
    }
  )

  return {
    invalidateSceneGenerations
  }
}
