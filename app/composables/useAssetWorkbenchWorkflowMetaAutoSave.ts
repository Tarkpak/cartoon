import { watch, type Ref } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type {
  AssetImageHistoryEntry,
  EnvironmentPanoramaState,
  FinalVideoAsset
} from '~/lib/asset-workbench-types'

/**
 * Workflow meta (scene configs, props, histories, panorama states, final video,
 * environment mother selections) is saved separately from the project; schedule
 * a debounced save whenever any of it changes after hydration.
 */
export function useAssetWorkbenchWorkflowMetaAutoSave(options: {
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  propAssets: Ref<PropAsset[]>
  sceneConfigs: Ref<Record<string, SceneConsistencyConfig>>
  environmentAssetHistories: Ref<Record<string, AssetImageHistoryEntry[]>>
  environmentPanoramaStates: Ref<Record<string, EnvironmentPanoramaState>>
  environmentMotherAssetSelections: Ref<Record<string, string>>
  finalVideo: Ref<FinalVideoAsset | null>
  workflowMetaReady: Ref<boolean>
  hydratingWorkflowMeta: Ref<boolean>
  scheduleWorkflowMetaSave: () => unknown
}) {
  const {
    scenes,
    characters,
    propAssets,
    sceneConfigs,
    environmentAssetHistories,
    environmentPanoramaStates,
    environmentMotherAssetSelections,
    finalVideo,
    workflowMetaReady,
    hydratingWorkflowMeta,
    scheduleWorkflowMetaSave
  } = options

  watch(
    [sceneConfigs, propAssets],
    () => {
      if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
      scheduleWorkflowMetaSave()
    },
    { deep: true }
  )

  watch(
    () => characters.value.map(character => ({
      id: character.id,
      assetHistory: character.assetHistory
    })),
    () => {
      if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
      scheduleWorkflowMetaSave()
    },
    { deep: true }
  )

  watch(
    () => scenes.value.map(scene => ({
      id: scene.id,
      videoHistory: scene.videoHistory
    })),
    () => {
      if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
      scheduleWorkflowMetaSave()
    },
    { deep: true }
  )

  watch(
    environmentAssetHistories,
    () => {
      if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
      scheduleWorkflowMetaSave()
    },
    { deep: true }
  )

  watch(
    environmentPanoramaStates,
    () => {
      if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
      scheduleWorkflowMetaSave()
    },
    { deep: true }
  )

  watch(
    finalVideo,
    () => {
      if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
      scheduleWorkflowMetaSave()
    },
    { deep: true }
  )

  watch(environmentMotherAssetSelections, () => {
    if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
    scheduleWorkflowMetaSave()
  })
}
