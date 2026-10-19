import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneData } from '~/lib/asset-workbench-models'
import { useAssetWorkflowMeta } from './useAssetWorkflowMeta'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()))

function setup() {
  const scenes = ref<SceneData[]>([{ id: 's', title: '场景', description: '画面', characters: [], duration: 8, active: true, referenceStatus: 'pending', videoStatus: 'pending', videoHistory: [{ id: 'old', videoUrl: 'https://shared.example/old.mp4', source: 'legacy' }] }])
  const projectAssetWorkflow = ref<unknown | null>(null)
  const propAssets = ref<any[]>([])
  const saveProject = vi.fn(async () => true)
  const onNormalized = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  const meta = scope.run(() => useAssetWorkflowMeta({
    projectId: ref('p'), projectAssetWorkflow, scenes, characters: ref([]),
    sceneConfigs: ref({}), propAssets, environmentMotherAssetSelections: ref({}),
    environmentAssetHistories: ref({}), environmentPanoramaStates: ref({}),
    finalVideo: ref(null), saveProject, onNormalized
  }))!
  return { meta, scenes, propAssets, projectAssetWorkflow, saveProject, onNormalized }
}

describe('workbench collaboration metadata hydration', () => {
  it('keeps resource-scoped video history and acknowledges defaults without saving them', async () => {
    const { meta, scenes, onNormalized, saveProject } = setup()
    await meta.loadWorkflowMeta(null)
    expect(scenes.value[0]!.videoHistory).toMatchObject([{ videoUrl: 'https://shared.example/old.mp4' }])
    expect(onNormalized).toHaveBeenCalledOnce()
    expect(onNormalized.mock.calls[0]![1].sceneVideoHistories.s[0].videoUrl).toBe('https://shared.example/old.mp4')
    expect(saveProject).not.toHaveBeenCalled()
  })

  it('hydrates incoming shared props into the existing UI without a write', async () => {
    const { meta, projectAssetWorkflow, propAssets, saveProject } = setup()
    await meta.loadWorkflowMeta(null)
    projectAssetWorkflow.value = { props: [{ id: 'prop', name: '云端道具', description: '其他成员更新', category: 'prop' }] }
    await vi.waitFor(() => expect(propAssets.value[0]?.name).toBe('云端道具'))
    expect(saveProject).not.toHaveBeenCalled()
  })

  it('honors an explicit empty history instead of resurrecting an old one', async () => {
    const { meta, scenes } = setup()
    await meta.loadWorkflowMeta({ sceneVideoHistories: { s: [] } })
    expect(scenes.value[0]!.videoHistory).toEqual([])
  })
})
