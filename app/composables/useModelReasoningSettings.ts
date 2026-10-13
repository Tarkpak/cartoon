import { ref } from 'vue'
import type { ReasoningEffort } from '#shared/utils/model-reasoning'

const efforts = ref<Record<string, ReasoningEffort>>({})
const saving = ref(false)
const error = ref('')
let loading: Promise<void> | null = null
let loaded = false
type Response = { success: boolean, data: Record<string, ReasoningEffort> }

export function useModelReasoningSettings() {
  async function load() {
    if (loaded) return
    if (loading) return loading
    loading = (async () => {
      try {
        const response = await $fetch<Response>('/api/model-providers/reasoning')
        efforts.value = response.data
        loaded = true
        error.value = ''
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : '加载推理强度失败'
      } finally {
        loading = null
      }
    })()
    return loading
  }

  async function save(provider: string, model: string, value: unknown) {
    if (saving.value || !['default', 'low', 'medium', 'high'].includes(String(value))) return
    saving.value = true
    error.value = ''
    try {
      await load()
      const response = await $fetch<Response>('/api/model-providers/reasoning', {
        method: 'PUT', body: { provider, model, effort: value }
      })
      efforts.value = response.data
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保存推理强度失败'
    } finally {
      saving.value = false
    }
  }

  return { efforts, saving, error, load, save }
}
