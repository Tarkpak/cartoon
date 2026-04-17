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
  function deleteScene(scene: SceneData) {
    if (!confirm(`确定要删除场景"${scene.title}"吗？`)) return
    options.scenes.value = deleteSceneFromList(options.scenes.value, scene.id)
    void options.saveProject()
  }

  function updateScene(updatedScene: Partial<SceneData> & { id: string }) {
    options.scenes.value = updateSceneInList(options.scenes.value, updatedScene)
  }

  function mergeWithNextScene(sceneIndex: number) {
    if (sceneIndex >= options.scenes.value.length - 1) {
      alert('这是最后一个场景，无法向后合并')
      return
    }

    const currentScene = options.scenes.value[sceneIndex]
    const nextScene = options.scenes.value[sceneIndex + 1]
    if (!currentScene || !nextScene) return

    if (!confirm(`确定要将"${currentScene.title}"与"${nextScene.title}"合并吗？`)) return

    const nextScenes = mergeScenesInList(options.scenes.value, sceneIndex)
    if (!nextScenes) return

    options.scenes.value = nextScenes
    void options.saveProject()
  }

  function splitScene(sceneIndex: number) {
    const scene = options.scenes.value[sceneIndex]
    if (!scene) return

    const sentences = scene.description.split(/(?<=[。！？.!?])/g).filter(item => item.trim())
    if (sentences.length < 2) {
      alert('场景描述太短，无法拆分。请先在编辑对话框中添加更多内容。')
      return
    }

    if (!confirm(`确定要将"${scene.title}"拆分为两个场景吗？`)) return

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
