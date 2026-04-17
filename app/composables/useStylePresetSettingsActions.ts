import type { StylePreset } from '#shared/types/styles'
import {
  buildStyleFormPayload,
  createStylePreset,
  deleteStylePresetRequest,
  downloadStylePresetExport,
  exportStylePresetCatalog,
  fetchStylePresetConfig,
  importStylePresetCatalog,
  normalizeStyleConfigState,
  parseStylePresetImportFile,
  resetStylePresetCatalog,
  saveStylePresetConfig,
  updateStylePreset,
  type StyleFormState
} from '~/lib/style-preset-settings'

interface UseStylePresetSettingsActionsOptions {
  refreshAvailableStyles: (force?: boolean) => Promise<unknown>
  allStylePresets: Ref<StylePreset[]>
  enabledStyleIdSet: Ref<Set<string>>
  styleDefaultId: Ref<string>
  savedEnabledStyleIds: Ref<string[]>
  savedDefaultStyleId: Ref<string>
  styleEditorMode: Ref<'create' | 'edit' | null>
  styleEditingId: Ref<string | null>
  styleConfigLoading: Ref<boolean>
  styleConfigSaving: Ref<boolean>
  styleCrudSaving: Ref<boolean>
  styleDeletingId: Ref<string | null>
  styleResetting: Ref<boolean>
  styleImporting: Ref<boolean>
  styleExporting: Ref<boolean>
  styleImportInputRef: Ref<HTMLInputElement | null>
  styleForm: StyleFormState
  enabledStyleIds: ComputedRef<string[]>
  hasStyleSelection: ComputedRef<boolean>
  closeStyleEditor: () => void
}

export function useStylePresetSettingsActions(
  options: UseStylePresetSettingsActionsOptions
) {
  function applyStyleConfigState(payload: {
    allPresets: StylePreset[]
    enabledStyleIds: string[]
    defaultStyleId: string
  }) {
    options.allStylePresets.value = payload.allPresets || []

    const normalized = normalizeStyleConfigState(
      options.allStylePresets.value,
      payload.enabledStyleIds || [],
      payload.defaultStyleId || ''
    )

    options.enabledStyleIdSet.value = new Set(normalized.enabledStyleIds)
    options.styleDefaultId.value = normalized.defaultStyleId
    options.savedEnabledStyleIds.value = [...normalized.enabledStyleIds]
    options.savedDefaultStyleId.value = normalized.defaultStyleId
  }

  async function loadStyleConfig() {
    options.styleConfigLoading.value = true

    try {
      const response = await fetchStylePresetConfig()
      if (!response.success || !response.data) return

      applyStyleConfigState({
        allPresets: response.data.allPresets || [],
        enabledStyleIds: response.data.enabledStyleIds || [],
        defaultStyleId: response.data.defaultStyleId || ''
      })
    } catch (error) {
      console.error('[useStylePresetSettings] 加载画风预设配置失败:', error)
    } finally {
      options.styleConfigLoading.value = false
    }
  }

  async function reloadStyleCatalog() {
    await loadStyleConfig()
    await options.refreshAvailableStyles(true)
  }

  async function submitStyleEditor() {
    if (!options.styleEditorMode.value) return

    options.styleCrudSaving.value = true

    try {
      const payload = buildStyleFormPayload(options.styleForm)

      if (options.styleEditorMode.value === 'create') {
        await createStylePreset(payload)
      } else if (options.styleEditingId.value) {
        await updateStylePreset(options.styleEditingId.value, payload)
      }

      await reloadStyleCatalog()
      options.closeStyleEditor()
    } catch (error) {
      console.error('[useStylePresetSettings] 保存画风预设失败:', error)
      alert('保存画风预设失败，请检查输入后重试。')
    } finally {
      options.styleCrudSaving.value = false
    }
  }

  async function deleteStylePreset(styleId: string) {
    if (!confirm(`确定删除画风预设 ${styleId} 吗？`)) return

    options.styleDeletingId.value = styleId

    try {
      await deleteStylePresetRequest(styleId)

      await reloadStyleCatalog()

      if (options.styleEditingId.value === styleId) {
        options.closeStyleEditor()
      }
    } catch (error) {
      console.error('[useStylePresetSettings] 删除画风预设失败:', error)
      alert('删除画风预设失败，请稍后重试。')
    } finally {
      options.styleDeletingId.value = null
    }
  }

  async function resetStylePresets() {
    if (!confirm('确定重置所有画风预设吗？此操作会恢复为系统默认预设。')) return

    options.styleResetting.value = true

    try {
      await resetStylePresetCatalog()
      await reloadStyleCatalog()
      options.closeStyleEditor()
    } catch (error) {
      console.error('[useStylePresetSettings] 重置画风预设失败:', error)
      alert('重置画风预设失败，请稍后重试。')
    } finally {
      options.styleResetting.value = false
    }
  }

  function triggerStyleImport() {
    options.styleImportInputRef.value?.click()
  }

  async function handleStyleImport(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    options.styleImporting.value = true

    try {
      const payload = await parseStylePresetImportFile(file)
      await importStylePresetCatalog(payload)

      await reloadStyleCatalog()
      options.closeStyleEditor()
    } catch (error) {
      console.error('[useStylePresetSettings] 导入画风预设失败:', error)
      alert('导入失败，请确认导入文件格式正确。')
    } finally {
      options.styleImporting.value = false
      input.value = ''
    }
  }

  async function exportStylePresets() {
    options.styleExporting.value = true

    try {
      const response = await exportStylePresetCatalog()
      if (!response.success || !response.data) return

      downloadStylePresetExport(response.data)
    } catch (error) {
      console.error('[useStylePresetSettings] 导出画风预设失败:', error)
      alert('导出画风预设失败，请稍后重试。')
    } finally {
      options.styleExporting.value = false
    }
  }

  async function saveStyleConfig() {
    if (!options.hasStyleSelection.value || options.styleConfigSaving.value) return

    options.styleConfigSaving.value = true

    try {
      const response = await saveStylePresetConfig({
        enabledStyleIds: options.enabledStyleIds.value,
        defaultStyleId: options.styleDefaultId.value || null
      })

      if (!response.success || !response.data) return

      applyStyleConfigState({
        allPresets: options.allStylePresets.value,
        enabledStyleIds: response.data.enabledStyleIds || [],
        defaultStyleId: response.data.defaultStyleId || ''
      })
      await options.refreshAvailableStyles(true)
    } catch (error) {
      console.error('[useStylePresetSettings] 保存画风预设配置失败:', error)
      alert('保存画风预设配置失败，请稍后重试。')
    } finally {
      options.styleConfigSaving.value = false
    }
  }

  return {
    loadStyleConfig,
    submitStyleEditor,
    deleteStylePreset,
    resetStylePresets,
    triggerStyleImport,
    handleStyleImport,
    exportStylePresets,
    saveStyleConfig
  }
}
