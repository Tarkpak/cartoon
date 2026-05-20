import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { SceneData } from '~/lib/asset-workbench-models'
import { mergeScenesInList, splitSceneInList } from '~/lib/asset-workbench-scenes'
import type { SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import { useAssetWorkbenchSceneManagement } from './useAssetWorkbenchSceneManagement'

function createScene(input: Partial<SceneData> & Pick<SceneData, 'id' | 'title' | 'description'>): SceneData {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    characters: input.characters || [],
    dialogues: input.dialogues || [],
    narration: input.narration,
    duration: input.duration || 8,
    setting: input.setting,
    active: input.active ?? false,
    shotType: input.shotType,
    cameraMovement: input.cameraMovement,
    cameraNote: input.cameraNote,
    environmentCaptureMode: input.environmentCaptureMode,
    transitionIn: input.transitionIn,
    transitionOut: input.transitionOut,
    transitionDuration: input.transitionDuration,
    firstFrame: input.firstFrame,
    lastFrame: input.lastFrame,
    videoUrl: input.videoUrl,
    videoHistory: input.videoHistory,
    referenceError: input.referenceError,
    videoError: input.videoError,
    referenceStatus: input.referenceStatus || 'pending',
    videoStatus: input.videoStatus || 'pending'
  }
}

function createSceneConfig(
  sceneId: string,
  overrides: Partial<SceneConsistencyConfig> = {}
): SceneConsistencyConfig {
  return {
    sceneId,
    mustReferenceAssetIds: [],
    consistencyLevel: 'soft',
    continuityNotes: '',
    usePreviousLastFrameAsFirstFrame: false,
    continuityLinkReason: '',
    ...overrides
  }
}

function createManagementHarness(input: {
  scenes: SceneData[]
  sceneConfigs: Record<string, SceneConsistencyConfig>
  splitScene?: (sceneIndex: number) => void
  mergeWithNextScene: (sceneIndex: number) => void
}) {
  const scenes = ref(input.scenes)
  const sceneConfigs = ref(input.sceneConfigs)
  const saveWorkflowMeta = vi.fn(async () => undefined)
  const synchronizeQueueItems = vi.fn()

  const management = useAssetWorkbenchSceneManagement({
    selectedSceneId: ref(input.scenes[0]?.id || ''),
    sceneEditDialogOpen: ref(false),
    editingScene: ref(null),
    scenes,
    characters: ref([]),
    sceneConfigs,
    propAssets: ref([]),
    allAssets: computed(() => []),
    environmentAssets: computed(() => []),
    uniqueSorted: values => Array.from(new Set(values.filter(Boolean))),
    normalizeToken: value => (value || '').trim().toLowerCase(),
    getValidAssetIdSet: () => new Set(),
    findCharacterByAssetRefId: () => undefined,
    resolveSceneDescriptionWithoutAssetMentions: raw => raw || '',
    updateScene: () => undefined,
    deleteScene: () => undefined,
    splitScene: input.splitScene || (() => undefined),
    mergeWithNextScene: input.mergeWithNextScene,
    saveProject: async () => undefined,
    saveWorkflowMeta,
    synchronizeQueueItems,
    createPropAssetId: () => 'prop_1',
    isSceneBusy: () => false
  })

  return {
    management,
    scenes,
    sceneConfigs,
    saveWorkflowMeta,
    synchronizeQueueItems
  }
}

describe('useAssetWorkbenchSceneManagement', () => {
  it('does not mutate scene configs when merge action does not change scenes', async () => {
    const sceneA = createScene({
      id: 'scene_a',
      title: 'A',
      description: 'A。B。'
    })
    const sceneB = createScene({
      id: 'scene_b',
      title: 'B',
      description: 'C。D。'
    })

    const harness = createManagementHarness({
      scenes: [sceneA, sceneB],
      sceneConfigs: {
        [sceneA.id]: createSceneConfig(sceneA.id, {
          mustReferenceAssetIds: ['char:a'],
          consistencyLevel: 'lock',
          continuityNotes: '保留A'
        }),
        [sceneB.id]: createSceneConfig(sceneB.id, {
          mustReferenceAssetIds: ['prop:b'],
          continuityNotes: '保留B'
        })
      },
      mergeWithNextScene: () => undefined
    })

    const beforeSnapshot = JSON.parse(JSON.stringify(harness.sceneConfigs.value))
    await harness.management.handleMergeWithNextScene(sceneA.id)

    expect(harness.sceneConfigs.value).toEqual(beforeSnapshot)
    expect(harness.saveWorkflowMeta).not.toHaveBeenCalled()
    expect(harness.synchronizeQueueItems).not.toHaveBeenCalled()
  })

  it('merges scene configs after a successful merge', async () => {
    const sceneA = createScene({
      id: 'scene_a',
      title: 'A',
      description: 'A。B。',
      episodeId: 'episode_1'
    })
    const sceneB = createScene({
      id: 'scene_b',
      title: 'B',
      description: 'C。D。',
      episodeId: 'episode_1'
    })

    const harness = createManagementHarness({
      scenes: [sceneA, sceneB],
      sceneConfigs: {
        [sceneA.id]: createSceneConfig(sceneA.id, {
          mustReferenceAssetIds: ['char:a'],
          consistencyLevel: 'lock',
          continuityNotes: 'note-a',
          usePreviousLastFrameAsFirstFrame: true,
          continuityLinkReason: 'reason-a'
        }),
        [sceneB.id]: createSceneConfig(sceneB.id, {
          mustReferenceAssetIds: ['prop:b'],
          consistencyLevel: 'soft',
          continuityNotes: 'note-b',
          continuityLinkReason: 'reason-b'
        })
      },
      mergeWithNextScene: (sceneIndex) => {
        const nextScenes = mergeScenesInList(harness.scenes.value, sceneIndex)
        if (nextScenes) {
          harness.scenes.value = nextScenes
        }
      }
    })

    await harness.management.handleMergeWithNextScene(sceneA.id)

    expect(harness.scenes.value).toHaveLength(1)
    expect(harness.sceneConfigs.value[sceneB.id]).toBeUndefined()
    expect(harness.sceneConfigs.value[sceneA.id]).toMatchObject({
      sceneId: sceneA.id,
      mustReferenceAssetIds: ['char:a', 'prop:b'],
      consistencyLevel: 'lock',
      continuityNotes: 'note-a；note-b',
      usePreviousLastFrameAsFirstFrame: true,
      continuityLinkReason: 'reason-a'
    })
    expect(harness.saveWorkflowMeta).toHaveBeenCalledTimes(1)
    expect(harness.synchronizeQueueItems).toHaveBeenCalledTimes(1)
  })

  it('copies scene config to the new scene after a successful split', async () => {
    const sceneA = createScene({
      id: 'scene_a',
      title: 'A',
      description: '第一句。第二句。'
    })

    const harness = createManagementHarness({
      scenes: [sceneA],
      sceneConfigs: {
        [sceneA.id]: createSceneConfig(sceneA.id, {
          mustReferenceAssetIds: ['char:a', 'prop:b'],
          consistencyLevel: 'lock',
          continuityNotes: 'split-note',
          continuityLinkReason: 'split-reason'
        })
      },
      splitScene: (sceneIndex) => {
        const nextScenes = splitSceneInList(harness.scenes.value, sceneIndex)
        if (nextScenes) {
          harness.scenes.value = nextScenes
        }
      },
      mergeWithNextScene: () => undefined
    })

    await harness.management.handleSplitScene(sceneA.id)

    expect(harness.scenes.value).toHaveLength(2)
    const newScene = harness.scenes.value[1]
    expect(newScene).toBeDefined()
    expect(newScene?.id).not.toBe(sceneA.id)
    expect(harness.sceneConfigs.value[newScene!.id]).toMatchObject({
      sceneId: newScene!.id,
      mustReferenceAssetIds: ['char:a', 'prop:b'],
      consistencyLevel: 'lock',
      continuityNotes: 'split-note',
      continuityLinkReason: 'split-reason',
      usePreviousLastFrameAsFirstFrame: true
    })
    expect(harness.saveWorkflowMeta).toHaveBeenCalledTimes(1)
    expect(harness.synchronizeQueueItems).toHaveBeenCalledTimes(1)
  })
})
