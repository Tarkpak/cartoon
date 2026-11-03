import type { Ref } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import type { AssetImageHistoryEntry, EnvironmentCropCaptureMode } from '~/lib/asset-workbench-types'
import { ensureAssetHistoryEntry, ensureVideoHistoryEntry } from '~/lib/asset-history'

/** Appends a new image/video to the history of a character, environment, prop or scene. */
export function useAssetWorkbenchAssetHistory(options: {
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  propAssets: Ref<PropAsset[]>
  environmentAssetHistories: Ref<Record<string, AssetImageHistoryEntry[]>>
}) {
  const { scenes, characters, propAssets, environmentAssetHistories } = options

  function recordCharacterHistory(
    characterId: string,
    image: string | undefined,
    options: {
      source: 'generated' | 'uploaded' | 'legacy'
      prompt?: string
      libraryAssetId?: string
      libraryAssetVersion?: number
    }
  ) {
    const character = characters.value.find(item => item.id === characterId)
    if (!character) return

    character.assetHistory = ensureAssetHistoryEntry(character.assetHistory, image, {
      source: options.source,
      prompt: options.prompt,
      libraryAssetId: options.libraryAssetId,
      libraryAssetVersion: options.libraryAssetVersion,
      createdAt: new Date().toISOString()
    })
  }

  function recordEnvironmentHistory(
    assetId: string,
    image: string,
    options: {
      source?: 'generated' | 'uploaded' | 'cropped' | 'legacy'
      prompt?: string
      viewMode?: EnvironmentCropCaptureMode
      libraryAssetId?: string
      libraryAssetVersion?: number
    } = {}
  ) {
    environmentAssetHistories.value = {
      ...environmentAssetHistories.value,
      [assetId]: ensureAssetHistoryEntry(environmentAssetHistories.value[assetId], image, {
        source: options.source,
        prompt: options.prompt,
        viewMode: options.viewMode,
        libraryAssetId: options.libraryAssetId,
        libraryAssetVersion: options.libraryAssetVersion,
        createdAt: new Date().toISOString()
      })
    }
  }

  function recordPropHistory(
    propId: string,
    image: string | undefined,
    options: {
      source: 'generated' | 'uploaded' | 'legacy'
      prompt?: string
    }
  ) {
    const prop = propAssets.value.find(item => item.id === propId)
    if (!prop) return

    prop.assetHistory = ensureAssetHistoryEntry(prop.assetHistory, image, {
      source: options.source,
      prompt: options.prompt,
      createdAt: new Date().toISOString()
    })
  }

  function recordSceneVideoHistory(
    sceneId: string,
    videoUrl: string | undefined,
    options: {
      source?: 'generated' | 'legacy'
      prompt?: string
    } = {}
  ) {
    const scene = scenes.value.find(item => item.id === sceneId)
    if (!scene) return

    scene.videoHistory = ensureVideoHistoryEntry(scene.videoHistory, videoUrl, {
      source: options.source,
      prompt: options.prompt,
      createdAt: new Date().toISOString()
    })
  }

  return {
    recordCharacterHistory,
    recordEnvironmentHistory,
    recordPropHistory,
    recordSceneVideoHistory
  }
}
