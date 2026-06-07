import type { AvailableModelsResponse, SelectedModels } from '#shared/types/provider'

interface SettingsModelsResponse {
  success: boolean
  data: {
    available: AvailableModelsResponse
    selected: SelectedModels
  }
}

const SETTINGS_MODEL_CATALOG_STATE_KEY = 'settings:model-catalog'
const SETTINGS_SELECTED_MODELS_STATE_KEY = 'settings:selected-models'
const SETTINGS_MODEL_LOADING_STATE_KEY = 'settings:model-catalog:loading'
const SETTINGS_MODEL_LOADED_STATE_KEY = 'settings:model-catalog:loaded'
const SETTINGS_MODEL_ERROR_STATE_KEY = 'settings:model-catalog:error'

export function useSettingsModelCatalog() {
  const models = useState<AvailableModelsResponse | null>(
    SETTINGS_MODEL_CATALOG_STATE_KEY,
    () => null
  )
  const selectedModels = useState<SelectedModels>(
    SETTINGS_SELECTED_MODELS_STATE_KEY,
    () => ({
      text: '',
      image: '',
      video: '',
      tts: '',
      asr: ''
    })
  )
  const loading = useState<boolean>(SETTINGS_MODEL_LOADING_STATE_KEY, () => false)
  const loaded = useState<boolean>(SETTINGS_MODEL_LOADED_STATE_KEY, () => false)
  const errorMessage = useState<string>(SETTINGS_MODEL_ERROR_STATE_KEY, () => '')

  async function loadModels(force = false) {
    if (!force && loaded.value) return
    if (loading.value) return

    loading.value = true
    errorMessage.value = ''

    try {
      const response = await $fetch<SettingsModelsResponse>('/api/models')
      if (!response.success) {
        errorMessage.value = '加载模型目录失败'
        return
      }

      models.value = response.data.available
      selectedModels.value = response.data.selected
      loaded.value = true
    } catch (error) {
      console.error('[useSettingsModelCatalog] 加载模型目录失败:', error)
      errorMessage.value = error instanceof Error ? error.message : '加载模型目录失败'
    } finally {
      loading.value = false
    }
  }

  return {
    models,
    selectedModels,
    loading,
    loaded,
    errorMessage,
    loadModels
  }
}
