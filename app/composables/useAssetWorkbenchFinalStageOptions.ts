import { computed, watch, type Ref } from 'vue'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { FinalMergeOptions } from '~/lib/asset-workbench-types'

/**
 * Final cut settings: the playback order of finished scene videos (kept in
 * sync as scenes finish or disappear) and the normalised merge options.
 */
export function useAssetWorkbenchFinalStageOptions(options: {
  scenes: Ref<SceneData[]>
  finalStageSceneOrder: Ref<string[]>
  finalStageMergeOptions: Ref<FinalMergeOptions>
  resolveSceneReferenceImage: (scene: SceneData) => string | undefined
  scheduleWorkflowMetaSave: () => void
}) {
  const {
    scenes,
    finalStageSceneOrder,
    finalStageMergeOptions,
    resolveSceneReferenceImage,
    scheduleWorkflowMetaSave
  } = options

  const finalStageScenes = computed(() => {
    return scenes.value
      .filter(scene => scene.videoStatus === 'done' && !!scene.videoUrl)
      .map(scene => ({
        id: scene.id,
        title: scene.title,
        duration: scene.duration,
        videoUrl: scene.videoUrl,
        thumbnail: scene.firstFrame || resolveSceneReferenceImage(scene),
        videoStatus: scene.videoStatus
      }))
  })

  const finalStageSceneIds = computed(() => finalStageScenes.value.map(scene => scene.id))

  function normalizeFinalStageSceneOrder(nextSceneIds: string[]) {
    const validIdSet = new Set(nextSceneIds)
    const normalized = finalStageSceneOrder.value.filter(sceneId => validIdSet.has(sceneId))

    for (const sceneId of nextSceneIds) {
      if (normalized.includes(sceneId)) continue
      normalized.push(sceneId)
    }

    finalStageSceneOrder.value = normalized
  }

  watch(
    finalStageSceneIds,
    (nextSceneIds) => {
      normalizeFinalStageSceneOrder(nextSceneIds)
    },
    { immediate: true }
  )

  function handleFinalStageSceneOrderUpdate(nextSceneIds: string[]) {
    const validIdSet = new Set(finalStageSceneIds.value)
    const normalized = nextSceneIds.filter(sceneId => validIdSet.has(sceneId))
    for (const sceneId of finalStageSceneIds.value) {
      if (normalized.includes(sceneId)) continue
      normalized.push(sceneId)
    }
    finalStageSceneOrder.value = normalized
  }

  function handleFinalStageMergeOptionsUpdate(payload: Partial<FinalMergeOptions>) {
    const next: FinalMergeOptions = {
      ...finalStageMergeOptions.value,
      ...payload
    }

    if (next.transitionType !== 'fade' && next.transitionType !== 'dissolve' && next.transitionType !== 'wipe') {
      next.transitionType = 'none'
    }

    const transitionDuration = Number(next.transitionDuration)
    next.transitionDuration = Number.isFinite(transitionDuration)
      ? Math.max(0.1, Math.min(2, transitionDuration))
      : 0.5

    next.addSubtitles = next.addSubtitles === true
    next.bgmUrl = typeof next.bgmUrl === 'string' ? next.bgmUrl : ''

    const bgmVolume = Number(next.bgmVolume)
    next.bgmVolume = Number.isFinite(bgmVolume)
      ? Math.max(0, Math.min(1, bgmVolume))
      : 0.3

    next.audioTracks = (next.audioTracks || []).map(track => ({
      ...track,
      startTime: Math.max(0, Number(track.startTime) || 0),
      duration: Number.isFinite(Number(track.duration)) ? Math.max(0.1, Number(track.duration)) : undefined,
      volume: Math.max(0, Math.min(1, Number(track.volume) || 0))
    }))

    finalStageMergeOptions.value = next
    scheduleWorkflowMetaSave()
  }

  return {
    finalStageScenes,
    handleFinalStageSceneOrderUpdate,
    handleFinalStageMergeOptionsUpdate
  }
}
