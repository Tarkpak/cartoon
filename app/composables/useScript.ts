/**
 * 剧本解析 Composable
 * 提供剧本解析和场景管理功能
 */

import type { Scene, ParsedScript, Dialogue } from '../../shared/types/script'

export interface ParseScriptOptions {
  maxScenes?: number
}

export function useScript() {
  const scenes = ref<Scene[]>([])
  const characters = ref<Array<{ name: string, description: string, role?: string }>>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const parseProgress = ref(0)

  /**
   * 解析剧本文本
   */
  async function parseScript(text: string, options: ParseScriptOptions = {}) {
    if (!text.trim()) {
      error.value = '请输入剧本文本'
      return null
    }

    loading.value = true
    error.value = null
    parseProgress.value = 10

    try {
      const data = await $fetch<{ success: boolean, result: ParsedScript }>('/api/script/parse', {
        method: 'POST',
        body: {
          text,
          maxScenes: options.maxScenes || 10
        }
      })

      parseProgress.value = 90

      if (data.success && data.result) {
        scenes.value = data.result.scenes
        characters.value = data.result.characters
        parseProgress.value = 100
        return data.result
      } else {
        throw new Error('解析失败')
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '剧本解析失败'
      console.error('[useScript] parseScript error:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 添加场景
   */
  function addScene(scene: Omit<Scene, 'id'>) {
    const newScene: Scene = {
      ...scene,
      id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    }
    scenes.value.push(newScene)
    return newScene
  }

  /**
   * 更新场景
   */
  function updateScene(id: string, updates: Partial<Scene>) {
    const index = scenes.value.findIndex(s => s.id === id)
    if (index !== -1) {
      scenes.value[index] = { ...scenes.value[index], ...updates }
      return scenes.value[index]
    }
    return null
  }

  /**
   * 删除场景
   */
  function deleteScene(id: string) {
    const index = scenes.value.findIndex(s => s.id === id)
    if (index !== -1) {
      scenes.value.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * 重新排序场景
   */
  function reorderScenes(fromIndex: number, toIndex: number) {
    const scene = scenes.value.splice(fromIndex, 1)[0]
    scenes.value.splice(toIndex, 0, scene)
  }

  /**
   * 添加对话到场景
   */
  function addDialogue(sceneId: string, dialogue: Dialogue) {
    const scene = scenes.value.find(s => s.id === sceneId)
    if (scene) {
      if (!scene.dialogues) {
        scene.dialogues = []
      }
      scene.dialogues.push(dialogue)
      return true
    }
    return false
  }

  /**
   * 获取场景总时长
   */
  const totalDuration = computed(() => {
    return scenes.value.reduce((sum, scene) => sum + (scene.duration || 8), 0)
  })

  /**
   * 清空所有数据
   */
  function reset() {
    scenes.value = []
    characters.value = []
    error.value = null
    parseProgress.value = 0
  }

  return {
    // 状态
    scenes,
    characters,
    loading,
    error,
    parseProgress,
    totalDuration,
    // 方法
    parseScript,
    addScene,
    updateScene,
    deleteScene,
    reorderScenes,
    addDialogue,
    reset
  }
}
