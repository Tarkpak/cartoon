import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { FinalMergeOptions } from '~/lib/asset-workbench-types'
import { useAssetWorkbenchFinalStageOptions } from './useAssetWorkbenchFinalStageOptions'

function createScene(id: string, done: boolean): SceneData {
  return {
    id,
    title: id,
    description: '',
    characters: [],
    duration: 8,
    active: true,
    referenceStatus: 'done',
    videoStatus: done ? 'done' : 'pending',
    videoUrl: done ? `https://cdn.test/${id}.mp4` : undefined
  }
}

function setup(scenes: SceneData[], order: string[] = []) {
  const sceneRefs = ref(scenes)
  const finalStageSceneOrder = ref(order)
  const finalStageMergeOptions = ref<FinalMergeOptions>({
    transitionType: 'none',
    transitionDuration: 0.5,
    addSubtitles: false,
    bgmUrl: '',
    bgmVolume: 0.3,
    audioTracks: []
  })
  const scheduleWorkflowMetaSave = vi.fn()
  const api = useAssetWorkbenchFinalStageOptions({
    scenes: sceneRefs,
    finalStageSceneOrder,
    finalStageMergeOptions,
    resolveSceneReferenceImage: scene => `ref:${scene.id}`,
    scheduleWorkflowMetaSave
  })
  return { ...api, scenes: sceneRefs, finalStageSceneOrder, finalStageMergeOptions, scheduleWorkflowMetaSave }
}

describe('useAssetWorkbenchFinalStageOptions', () => {
  it('lists only finished scenes and falls back to the reference image as thumbnail', () => {
    const { finalStageScenes } = setup([createScene('a', true), createScene('b', false)])
    expect(finalStageScenes.value.map(scene => [scene.id, scene.thumbnail])).toEqual([['a', 'ref:a']])
  })

  it('keeps the saved order, drops missing scenes and appends newly finished ones', async () => {
    const { scenes, finalStageSceneOrder } = setup(
      [createScene('a', true), createScene('b', true)],
      ['b', 'gone', 'a']
    )
    expect(finalStageSceneOrder.value).toEqual(['b', 'a'])

    scenes.value.push(createScene('c', true))
    await nextTick()
    expect(finalStageSceneOrder.value).toEqual(['b', 'a', 'c'])
  })

  it('ignores unknown ids in a reorder and keeps scenes the caller left out', () => {
    const { handleFinalStageSceneOrderUpdate, finalStageSceneOrder } = setup([
      createScene('a', true),
      createScene('b', true),
      createScene('c', true)
    ])
    handleFinalStageSceneOrderUpdate(['c', 'x', 'a'])
    expect(finalStageSceneOrder.value).toEqual(['c', 'a', 'b'])
  })

  it('clamps merge options and schedules a save', () => {
    const { handleFinalStageMergeOptionsUpdate, finalStageMergeOptions, scheduleWorkflowMetaSave } = setup([])
    handleFinalStageMergeOptionsUpdate({
      transitionType: 'spin' as never,
      transitionDuration: 9,
      bgmVolume: -1,
      audioTracks: [{ id: 't', kind: 'sfx', url: 'u', startTime: -3, volume: 4 } as never]
    })
    expect(finalStageMergeOptions.value).toMatchObject({
      transitionType: 'none',
      transitionDuration: 2,
      bgmVolume: 0,
      audioTracks: [{ startTime: 0, volume: 1 }]
    })
    expect(scheduleWorkflowMetaSave).toHaveBeenCalledOnce()
  })
})
