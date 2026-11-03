import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from './useAssetWorkflowMeta'
import { useAssetWorkbenchDependencyInvalidation } from './useAssetWorkbenchDependencyInvalidation'

function createCharacter(id: string, name: string, baseImage?: string): CharacterData {
  return { id, name, baseImage, appearance: '', role: 'supporting', generating: false, generatingViews: false }
}

function createGeneratedScene(id: string): SceneData {
  return {
    id,
    title: id,
    description: '',
    characters: [],
    duration: 8,
    active: true,
    referenceStatus: 'done',
    firstFrame: `https://cdn.test/${id}.png`,
    videoStatus: 'done',
    videoUrl: `https://cdn.test/${id}.mp4`
  }
}

function config(sceneId: string, refs: string[]): SceneConsistencyConfig {
  return { sceneId, mustReferenceAssetIds: refs, consistencyLevel: 'soft', continuityNotes: '' }
}

function setup() {
  const scenes = ref([createGeneratedScene('s1'), createGeneratedScene('s2'), createGeneratedScene('s3')])
  const characters = ref([createCharacter('lin', '林婉', 'https://cdn.test/lin.png')])
  const propAssets = ref<PropAsset[]>([{ id: 'knife', name: '短刀', description: '', category: 'prop', referenceImage: 'https://cdn.test/knife.png' } as PropAsset])
  const sceneConfigs = ref<Record<string, SceneConsistencyConfig>>({
    s1: config('s1', ['char:lin']),
    s2: config('s2', ['prop:knife']),
    s3: config('s3', [])
  })
  const workflowMetaReady = ref(true)
  const hydratingWorkflowMeta = ref(false)
  const synchronizeQueueItems = vi.fn()
  const saveProject = vi.fn(async () => true)
  const api = useAssetWorkbenchDependencyInvalidation({
    scenes,
    characters,
    propAssets,
    sceneConfigs,
    workflowMetaReady,
    hydratingWorkflowMeta,
    synchronizeQueueItems,
    saveProject
  })
  return { ...api, scenes, characters, propAssets, workflowMetaReady, saveProject, synchronizeQueueItems }
}

const flush = async () => {
  await nextTick()
  await Promise.resolve()
}

describe('useAssetWorkbenchDependencyInvalidation', () => {
  it('resets generated frames of scenes that reference a renamed character', async () => {
    const { characters, scenes, saveProject } = setup()
    characters.value[0]!.name = '林婉儿'
    await flush()

    expect(scenes.value[0]).toMatchObject({ referenceStatus: 'pending', videoStatus: 'pending' })
    expect(scenes.value[0]!.firstFrame).toBeFalsy()
    expect(scenes.value[2]!.videoStatus).toBe('done')
    expect(saveProject).toHaveBeenCalledOnce()
  })

  it('only resets the video when a character image changes', async () => {
    const { characters, scenes } = setup()
    characters.value[0]!.baseImage = 'https://cdn.test/lin-v2.png'
    await flush()

    expect(scenes.value[0]).toMatchObject({ referenceStatus: 'done', videoStatus: 'pending' })
    expect(scenes.value[0]!.firstFrame).toBe('https://cdn.test/s1.png')
  })

  it('debounces prop changes before invalidating dependent scenes', async () => {
    vi.useFakeTimers()
    try {
      const { propAssets, scenes, saveProject } = setup()
      propAssets.value[0]!.referenceImage = 'https://cdn.test/knife-v2.png'
      await flush()
      expect(scenes.value[1]!.videoStatus).toBe('done')

      await vi.advanceTimersByTimeAsync(600)
      expect(scenes.value[1]!.videoStatus).toBe('pending')
      expect(saveProject).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores changes made while workflow meta is still loading', async () => {
    const { characters, scenes, workflowMetaReady, saveProject } = setup()
    workflowMetaReady.value = false
    characters.value[0]!.name = '别名'
    await flush()

    expect(scenes.value[0]!.videoStatus).toBe('done')
    expect(saveProject).not.toHaveBeenCalled()
  })
})
