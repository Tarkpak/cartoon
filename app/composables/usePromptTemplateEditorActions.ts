import type { ComputedRef, Ref } from 'vue'
import type {
  PromptTemplate,
  PromptVersion
} from '#shared/types/prompt-template'
import {
  exportPromptTemplate as downloadPromptTemplate,
  fetchPromptVersions,
  mergePromptEditorContent,
  parsePromptTemplateImport,
  resetPromptTemplate,
  restorePromptTemplate,
  savePromptTemplate
} from '@/lib/prompt-template-editor'

interface UsePromptTemplateEditorActionsOptions {
  template: Ref<PromptTemplate>
  isReadonly: ComputedRef<boolean>
  localContent: Ref<PromptTemplate['content']>
  showDiff: Ref<boolean>
  onUpdate: (template: PromptTemplate) => void
  onSaved: () => void
  updateEditorContent: () => void
}

export function usePromptTemplateEditorActions(
  options: UsePromptTemplateEditorActionsOptions
) {
  const saving = ref(false)
  const resetting = ref(false)
  const showHistory = ref(false)
  const loadingVersions = ref(false)
  const versions = ref<PromptVersion[]>([])
  const fileInputRef = ref<HTMLInputElement | null>(null)
  const actionError = ref('')

  async function save() {
    if (options.isReadonly.value) return
    saving.value = true
    actionError.value = ''

    try {
      const response = await savePromptTemplate({
        templateId: options.template.value.id,
        content: options.localContent.value
      })

      if (!response.success) {
        actionError.value = '保存提示词模板失败'
        return
      }

      options.onUpdate(response.data)
      options.onSaved()
      options.showDiff.value = false
    } catch (error) {
      console.error('保存失败:', error)
      actionError.value = error instanceof Error ? error.message : '保存提示词模板失败'
    } finally {
      saving.value = false
    }
  }

  async function reset() {
    if (options.isReadonly.value) return

    resetting.value = true
    actionError.value = ''

    try {
      const response = await resetPromptTemplate({
        templateId: options.template.value.id
      })

      if (response.success) {
        options.onUpdate(response.data)
      } else {
        actionError.value = '重置提示词模板失败'
      }
    } catch (error) {
      console.error('重置失败:', error)
      actionError.value = error instanceof Error ? error.message : '重置提示词模板失败'
    } finally {
      resetting.value = false
    }
  }

  async function loadVersions() {
    loadingVersions.value = true
    actionError.value = ''

    try {
      const response = await fetchPromptVersions({
        templateId: options.template.value.id
      })

      if (response.success) {
        versions.value = response.data.versions
      }
    } catch (error) {
      console.error('加载版本历史失败:', error)
      actionError.value = error instanceof Error ? error.message : '加载版本历史失败'
    } finally {
      loadingVersions.value = false
    }
  }

  function openHistory() {
    showHistory.value = true
    void loadVersions()
  }

  async function restoreVersion(versionId: string) {
    if (options.isReadonly.value) return

    actionError.value = ''

    try {
      const response = await restorePromptTemplate({
        templateId: options.template.value.id,
        versionId
      })

      if (response.success) {
        options.onUpdate(response.data)
        showHistory.value = false
      } else {
        actionError.value = '恢复版本失败'
      }
    } catch (error) {
      console.error('恢复版本失败:', error)
      actionError.value = error instanceof Error ? error.message : '恢复版本失败'
    }
  }

  function exportTemplate() {
    downloadPromptTemplate(options.template.value, options.localContent.value)
  }

  function triggerImport() {
    if (options.isReadonly.value) return
    fileInputRef.value?.click()
  }

  async function handleImport(event: Event) {
    if (options.isReadonly.value) return
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    actionError.value = ''

    try {
      const importedContent = await parsePromptTemplateImport(file)
      options.localContent.value = mergePromptEditorContent(
        options.localContent.value,
        importedContent
      )
      options.updateEditorContent()
    } catch (error) {
      console.error('导入失败:', error)
      actionError.value = '导入失败：文件格式不正确'
    }

    input.value = ''
  }

  return {
    saving,
    resetting,
    showHistory,
    loadingVersions,
    versions,
    fileInputRef,
    actionError,
    save,
    reset,
    openHistory,
    restoreVersion,
    exportTemplate,
    triggerImport,
    handleImport
  }
}
