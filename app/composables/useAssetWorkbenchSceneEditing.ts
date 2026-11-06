import type { SceneData } from '~/lib/asset-workbench-models'
import { ref, watch, type Ref } from 'vue'
import { createSceneSplitDraft, type SceneSplitDraft } from '~/lib/scene-split'
import {
  deleteSceneFromList,
  mergeScenesInList,
  splitSceneInList,
  updateSceneInList
} from '~/lib/asset-workbench-scenes'

interface UseAssetWorkbenchSceneEditingOptions {
  scenes: Ref<SceneData[]>
  saveProject: () => Promise<unknown>
  projectId: Ref<string | undefined>
  editable: Ref<boolean>
}

export function useAssetWorkbenchSceneEditing(
  options: UseAssetWorkbenchSceneEditingOptions
) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const splitDraft = ref<SceneSplitDraft | null>(null)
  const splitError = ref('')
  const splitSaving = ref(false)
  let settleSplit: ((accepted: boolean) => void) | undefined
  function closeSplit() {
    if (splitSaving.value) return
    splitDraft.value = null
    settleSplit?.(false)
    settleSplit = undefined
  }
  function acceptSplit() {
    if (!splitDraft.value || splitDraft.value.some(part => !part.description.trim() || !Number.isFinite(part.duration) || part.duration < 4)) return
    settleSplit?.(true)
    settleSplit = undefined
  }
  watch(options.projectId, () => {
    splitDraft.value = null
    settleSplit?.(false)
    settleSplit = undefined
  })

  async function deleteScene(scene: SceneData) {
    const ok = await confirm({
      title: '删除场景',
      description: `确定要删除场景"${scene.title}"吗？此操作无法撤销。`,
      confirmText: '删除',
      variant: 'destructive'
    })
    if (!ok) return
    options.scenes.value = deleteSceneFromList(options.scenes.value, scene.id)
    void options.saveProject()
  }

  function updateScene(updatedScene: Partial<SceneData> & { id: string }) {
    options.scenes.value = updateSceneInList(options.scenes.value, updatedScene)
  }

  async function mergeWithNextScene(sceneIndex: number) {
    if (sceneIndex >= options.scenes.value.length - 1) {
      toast.warning('这是最后一个场景，无法向后合并')
      return
    }

    const currentScene = options.scenes.value[sceneIndex]
    const nextScene = options.scenes.value[sceneIndex + 1]
    if (!currentScene || !nextScene) return

    const ok = await confirm({
      title: '合并场景',
      description: `确定要将"${currentScene.title}"与"${nextScene.title}"合并吗？`,
      confirmText: '合并'
    })
    if (!ok) return

    const nextScenes = mergeScenesInList(options.scenes.value, sceneIndex)
    if (!nextScenes) return

    options.scenes.value = nextScenes
    void options.saveProject()
  }

  async function splitScene(sceneIndex: number) {
    const scene = options.scenes.value[sceneIndex]
    if (!scene || !options.editable.value || splitDraft.value || splitSaving.value) return
    if (scene.videoStatus === 'generating' || scene.referenceStatus === 'generating') return
    const projectId = options.projectId.value
    const snapshot = JSON.stringify(scene)

    if (scene.duration < 8) {
      toast.warning('当前场景时长不足，无法拆分', { description: '拆分后的每个分镜至少需要 4 秒。' })
      return
    }

    const draft = createSceneSplitDraft(scene)
    if (!draft) {
      toast.warning('场景描述太短，无法拆分', { description: '请先在编辑对话框中添加更多内容。' })
      return
    }

    splitDraft.value = draft
    splitError.value = ''
    const ok = await new Promise<boolean>((resolve) => { settleSplit = resolve })
    if (!ok) return
    const currentIndex = options.scenes.value.findIndex(item => item.id === scene.id)
    const currentScene = options.scenes.value[currentIndex]
    if (options.projectId.value !== projectId || !options.editable.value || !currentScene || JSON.stringify(currentScene) !== snapshot) {
      splitDraft.value = null
      toast.warning('项目或场景已变化，请重新打开拆分预览')
      return
    }
    const nextScenes = splitSceneInList(options.scenes.value, currentIndex, splitDraft.value || draft)
    if (!nextScenes) {
      splitError.value = '两段描述不能为空，每段至少 4 秒，时长之和必须等于原场景。请重新调整。'
      splitDraft.value = null
      toast.warning(splitError.value)
      return
    }
    const previousScenes = options.scenes.value
    options.scenes.value = nextScenes
    const appliedScenes = options.scenes.value
    splitSaving.value = true
    try {
      if (await options.saveProject() === false) throw new Error('保存失败')
    } catch {
      if (options.projectId.value === projectId && options.scenes.value === appliedScenes) options.scenes.value = previousScenes
      toast.warning('拆分保存失败，已恢复原场景，请重试')
    } finally {
      splitSaving.value = false
      splitDraft.value = null
    }
  }

  return {
    deleteScene,
    updateScene,
    mergeWithNextScene,
    splitScene,
    splitDraft, splitError, splitSaving, closeSplit, acceptSplit
  }
}
