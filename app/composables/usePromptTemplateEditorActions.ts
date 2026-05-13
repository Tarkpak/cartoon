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

  async function save() {
    if (options.isReadonly.value) return
    saving.value = true

    try {
      const response = await savePromptTemplate({
        templateId: options.template.value.id,
        content: options.localContent.value
      })

      if (!response.success) return

      options.onUpdate(response.data)
      options.onSaved()
      options.showDiff.value = false
    } catch (error) {
      console.error('保存失败:', error)
    } finally {
      saving.value = false
    }
  }

  async function reset() {
    if (options.isReadonly.value) return
    if (!confirm('确定要重置此模板为默认值吗？')) return

    resetting.value = true

    try {
      const response = await resetPromptTemplate({
        templateId: options.template.value.id
      })

      if (response.success) {
        options.onUpdate(response.data)
      }
    } catch (error) {
      console.error('重置失败:', error)
    } finally {
      resetting.value = false
    }
  }

  async function loadVersions() {
    loadingVersions.value = true

    try {
      const response = await fetchPromptVersions({
        templateId: options.template.value.id
      })

      if (response.success) {
        versions.value = response.data.versions
      }
    } catch (error) {
      console.error('加载版本历史失败:', error)
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
    if (!confirm('确定要恢复到此版本吗？')) return

    try {
      const response = await restorePromptTemplate({
        templateId: options.template.value.id,
        versionId
      })

      if (response.success) {
        options.onUpdate(response.data)
        showHistory.value = false
      }
    } catch (error) {
      console.error('恢复版本失败:', error)
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

    try {
      const importedContent = await parsePromptTemplateImport(file)
      options.localContent.value = mergePromptEditorContent(
        options.localContent.value,
        importedContent
      )
      options.updateEditorContent()
    } catch (error) {
      console.error('导入失败:', error)
      alert('导入失败：文件格式不正确')
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
    save,
    reset,
    openHistory,
    restoreVersion,
    exportTemplate,
    triggerImport,
    handleImport
  }
}
