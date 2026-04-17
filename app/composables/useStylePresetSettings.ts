import type { StylePreset, StyleCategory } from '#shared/types/styles'
import {
  applyStyleFormState,
  createDefaultStyleFormState,
  filterStylePresets,
  getStyleCategoryName,
  hasStyleConfigChanges as hasStyleConfigChangesForState
} from '~/lib/style-preset-settings'
import { useStylePresetSettingsActions } from '~/composables/useStylePresetSettingsActions'

export function useStylePresetSettings() {
  const { loadStylePresets: refreshAvailableStyles } = useStylePresets()

  const styleConfigLoading = ref(false)
  const styleConfigSaving = ref(false)
  const allStylePresets = ref<StylePreset[]>([])
  const enabledStyleIdSet = ref<Set<string>>(new Set())
  const styleDefaultId = ref('')
  const styleSearchKeyword = ref('')
  const styleCategoryFilter = ref<'all' | 'enabled' | StyleCategory>('all')
  const savedEnabledStyleIds = ref<string[]>([])
  const savedDefaultStyleId = ref('')
  const styleEditorMode = ref<'create' | 'edit' | null>(null)
  const styleEditingId = ref<string | null>(null)
  const styleCrudSaving = ref(false)
  const styleDeletingId = ref<string | null>(null)
  const styleResetting = ref(false)
  const styleImporting = ref(false)
  const styleExporting = ref(false)
  const styleImportInputRef = ref<HTMLInputElement | null>(null)
  const styleForm = reactive(createDefaultStyleFormState())

  const enabledStyleIds = computed(() => Array.from(enabledStyleIdSet.value))
  const enabledStyleCount = computed(() => enabledStyleIdSet.value.size)
  const hasStyleSelection = computed(() => enabledStyleIdSet.value.size > 0)

  const stylePresetMap = computed(() => {
    return new Map(allStylePresets.value.map(style => [style.id, style]))
  })

  const hasStyleConfigChanges = computed(() => {
    return hasStyleConfigChangesForState({
      currentEnabledIds: Array.from(enabledStyleIdSet.value),
      savedEnabledIds: savedEnabledStyleIds.value,
      currentDefaultStyleId: styleDefaultId.value,
      savedDefaultStyleId: savedDefaultStyleId.value
    })
  })

  const filteredStylePresets = computed(() => {
    return filterStylePresets({
      allStylePresets: allStylePresets.value,
      enabledStyleIdSet: enabledStyleIdSet.value,
      styleCategoryFilter: styleCategoryFilter.value,
      styleSearchKeyword: styleSearchKeyword.value
    })
  })

  const currentDefaultStyle = computed(() => {
    return stylePresetMap.value.get(styleDefaultId.value) || null
  })

  function resetStyleForm() {
    Object.assign(styleForm, createDefaultStyleFormState())
  }

  function openCreateStyleEditor() {
    resetStyleForm()
    styleEditorMode.value = 'create'
    styleEditingId.value = null
  }

  function openEditStyleEditor(style: StylePreset) {
    applyStyleFormState({
      styleForm,
      style,
      enabledStyleIdSet: enabledStyleIdSet.value,
      styleDefaultId: styleDefaultId.value
    })
    styleEditorMode.value = 'edit'
    styleEditingId.value = style.id
  }

  function closeStyleEditor() {
    styleEditorMode.value = null
    styleEditingId.value = null
  }

  function handleStyleEditorOpenChange(open: boolean) {
    if (open || styleCrudSaving.value) return
    closeStyleEditor()
  }

  function toggleStyleEnabled(styleId: string) {
    const nextEnabled = new Set(enabledStyleIdSet.value)

    if (nextEnabled.has(styleId)) {
      if (nextEnabled.size <= 1) return
      nextEnabled.delete(styleId)
    } else {
      nextEnabled.add(styleId)
    }

    enabledStyleIdSet.value = nextEnabled

    if (!nextEnabled.has(styleDefaultId.value)) {
      styleDefaultId.value = Array.from(nextEnabled)[0] || ''
    }
  }

  function setDefaultStyle(styleId: string) {
    if (!enabledStyleIdSet.value.has(styleId)) return
    if (styleConfigSaving.value) return
    if (styleDefaultId.value === styleId) return

    styleDefaultId.value = styleId
    void saveStyleConfig()
  }

  function enableAllStyles() {
    const allIds = allStylePresets.value.map(style => style.id)
    enabledStyleIdSet.value = new Set(allIds)

    if (!enabledStyleIdSet.value.has(styleDefaultId.value)) {
      styleDefaultId.value = allIds[0] || ''
    }
  }

  const {
    loadStyleConfig,
    submitStyleEditor,
    deleteStylePreset,
    resetStylePresets,
    triggerStyleImport,
    handleStyleImport,
    exportStylePresets,
    saveStyleConfig
  } = useStylePresetSettingsActions({
    refreshAvailableStyles,
    allStylePresets,
    enabledStyleIdSet,
    styleDefaultId,
    savedEnabledStyleIds,
    savedDefaultStyleId,
    styleEditorMode,
    styleEditingId,
    styleConfigLoading,
    styleConfigSaving,
    styleCrudSaving,
    styleDeletingId,
    styleResetting,
    styleImporting,
    styleExporting,
    styleImportInputRef,
    styleForm,
    enabledStyleIds,
    hasStyleSelection,
    closeStyleEditor
  })

  onMounted(() => {
    if (allStylePresets.value.length > 0) return
    void loadStyleConfig()
  })

  return {
    styleConfigLoading,
    styleConfigSaving,
    allStylePresets,
    enabledStyleIdSet,
    styleDefaultId,
    styleSearchKeyword,
    styleCategoryFilter,
    styleEditorMode,
    styleEditingId,
    styleCrudSaving,
    styleDeletingId,
    styleResetting,
    styleImporting,
    styleExporting,
    styleImportInputRef,
    styleForm,
    enabledStyleCount,
    hasStyleSelection,
    hasStyleConfigChanges,
    filteredStylePresets,
    currentDefaultStyle,
    getStyleCategoryName,
    openCreateStyleEditor,
    openEditStyleEditor,
    closeStyleEditor,
    handleStyleEditorOpenChange,
    submitStyleEditor,
    deleteStylePreset,
    resetStylePresets,
    triggerStyleImport,
    handleStyleImport,
    exportStylePresets,
    toggleStyleEnabled,
    setDefaultStyle,
    enableAllStyles,
    saveStyleConfig
  }
}
