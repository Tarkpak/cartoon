import type { SceneData } from '~/lib/asset-workbench-models'
import {
  deleteSceneFromList,
  mergeScenesInList,
  splitSceneInList,
  updateSceneInList
} from '~/lib/asset-workbench-scenes'

interface UseAssetWorkbenchSceneEditingOptions {
  scenes: Ref<SceneData[]>
  saveProject: () => Promise<unknown>
}

export function useAssetWorkbenchSceneEditing(
  options: UseAssetWorkbenchSceneEditingOptions
) {
  const { toast } = useToast()
  const { confirm } = useConfirm()

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
    if (!scene) return

    if (scene.duration < 8) {
      toast.warning('当前场景时长不足，无法拆分', { description: '拆分后的每个分镜至少需要 4 秒。' })
      return
    }

    const sentences = scene.description.split(/(?<=[。！？.!?])/g).filter(item => item.trim())
    if (sentences.length < 2) {
      toast.warning('场景描述太短，无法拆分', { description: '请先在编辑对话框中添加更多内容。' })
      return
    }

    const ok = await confirm({
      title: '拆分场景',
      description: `确定要将"${scene.title}"拆分为两个场景吗？`,
      confirmText: '拆分'
    })
    if (!ok) return

    const nextScenes = splitSceneInList(options.scenes.value, sceneIndex)
    if (!nextScenes) return

    options.scenes.value = nextScenes
    void options.saveProject()
  }

  return {
    deleteScene,
    updateScene,
    mergeWithNextScene,
    splitScene
  }
}
