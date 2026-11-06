import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneData } from '~/lib/asset-workbench-models'
import { useAssetWorkbenchSceneEditing } from './useAssetWorkbenchSceneEditing'

afterEach(() => vi.unstubAllGlobals())

function setup(saved = true) {
  vi.stubGlobal('useToast', () => ({ toast: { warning: vi.fn() } }))
  vi.stubGlobal('useConfirm', () => ({ confirm: vi.fn() }))
  const scenes = ref<SceneData[]>([{
    id: 's1', title: '原场景', description: '第一句。第二句。', duration: 8,
    characters: [], active: true, referenceStatus: 'done', videoStatus: 'done'
  }])
  const projectId = ref<string | undefined>('p1')
  const saveProject = vi.fn(async () => saved)
  const scope = effectScope()
  const editing = scope.run(() => useAssetWorkbenchSceneEditing({ scenes, projectId, editable: ref(true), saveProject }))!
  return { editing, scenes, projectId, saveProject, scope }
}

describe('split confirmation and persistence', () => {
  it('does not mutate or save before confirmation and supports cancellation', async () => {
    const h = setup()
    const pending = h.editing.splitScene(0)
    expect(h.editing.splitDraft.value).not.toBeNull()
    expect(h.scenes.value).toHaveLength(1)
    expect(h.saveProject).not.toHaveBeenCalled()
    h.editing.closeSplit()
    await pending
    expect(h.scenes.value).toHaveLength(1)
    h.scope.stop()
  })

  it('rolls back the split when saving fails', async () => {
    const h = setup(false)
    const pending = h.editing.splitScene(0)
    h.editing.acceptSplit()
    await pending
    expect(h.saveProject).toHaveBeenCalledTimes(1)
    expect(h.scenes.value).toHaveLength(1)
    expect(h.scenes.value[0]!.description).toBe('第一句。第二句。')
    h.scope.stop()
  })

  it('cancels the preview on project change', async () => {
    const h = setup()
    const pending = h.editing.splitScene(0)
    h.projectId.value = 'p2'
    await nextTick()
    await pending
    expect(h.editing.splitDraft.value).toBeNull()
    expect(h.saveProject).not.toHaveBeenCalled()
    h.scope.stop()
  })

  it('rejects a scene modified while previewing', async () => {
    const h = setup()
    const pending = h.editing.splitScene(0)
    h.scenes.value[0]!.description = '新的描述。另一句。'
    h.editing.acceptSplit()
    await pending
    expect(h.scenes.value).toHaveLength(1)
    expect(h.saveProject).not.toHaveBeenCalled()
    h.scope.stop()
  })
})
