import type { ComputedRef, Ref } from 'vue'
import type {
  PromptTemplate,
  PromptVersion
} from '#shared/types/prompt-template'
import type { ProjectWorkflowType } from '#shared/types/project'
import {
  exportPromptTemplate as downloadPromptTemplate,
  fetchPromptLangConfig,
  fetchPromptVersions,
  mergePromptEditorContent,
  parsePromptTemplateImport,
  resetPromptTemplate,
  restorePromptTemplate,
  savePromptTemplate,
  translatePromptContent,
  updatePromptLangConfig,
  type PromptEditorLanguage
} from '@/lib/prompt-template-editor'

interface UsePromptTemplateEditorActionsOptions {
  template: Ref<PromptTemplate>
  workflow: ComputedRef<ProjectWorkflowType>
  localContent: Ref<PromptTemplate['content']>
  activeLanguage: Ref<PromptEditorLanguage>
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
  const langConfig = ref<Record<string, PromptEditorLanguage>>({})
  const langConfigSaving = ref(false)
  const translating = ref(false)
  const fileInputRef = ref<HTMLInputElement | null>(null)

  const currentTemplateLang = computed({
    get: () => langConfig.value[options.template.value.id] || 'zh',
    set: (value: PromptEditorLanguage) => {
      langConfig.value[options.template.value.id] = value
    }
  })

  async function save() {
    saving.value = true

    try {
      const response = await savePromptTemplate({
        templateId: options.template.value.id,
        workflow: options.workflow.value,
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
    if (!confirm('确定要重置此模板为默认值吗？')) return

    resetting.value = true

    try {
      const response = await resetPromptTemplate({
        templateId: options.template.value.id,
        workflow: options.workflow.value
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
        templateId: options.template.value.id,
        workflow: options.workflow.value
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
    if (!confirm('确定要恢复到此版本吗？')) return

    try {
      const response = await restorePromptTemplate({
        templateId: options.template.value.id,
        workflow: options.workflow.value,
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

  async function loadLangConfig() {
    try {
      const response = await fetchPromptLangConfig(options.workflow.value)

      if (response.success) {
        langConfig.value = response.data
      }
    } catch (error) {
      console.error('加载语言配置失败:', error)
    }
  }

  async function saveLangConfig() {
    langConfigSaving.value = true

    try {
      await updatePromptLangConfig({
        workflow: options.workflow.value,
        templateId: options.template.value.id,
        lang: currentTemplateLang.value
      })
    } catch (error) {
      console.error('保存语言配置失败:', error)
    } finally {
      langConfigSaving.value = false
    }
  }

  async function toggleRuntimeLang(lang: PromptEditorLanguage) {
    currentTemplateLang.value = lang
    await saveLangConfig()
  }

  async function translateContent() {
    const fromLang = options.activeLanguage.value
    const toLang = fromLang === 'zh' ? 'en' : 'zh'
    const sourceText = options.localContent.value[fromLang]
    if (!sourceText.trim()) return

    translating.value = true

    try {
      const response = await translatePromptContent({
        text: sourceText,
        from: fromLang,
        to: toLang
      })

      if (response.success && response.data?.translatedText) {
        options.localContent.value[toLang] = response.data.translatedText
      }
    } catch (error) {
      console.error('翻译失败:', error)
    } finally {
      translating.value = false
    }
  }

  function exportTemplate() {
    downloadPromptTemplate(options.template.value, options.localContent.value)
  }

  function triggerImport() {
    fileInputRef.value?.click()
  }

  async function handleImport(event: Event) {
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
    langConfigSaving,
    translating,
    fileInputRef,
    currentTemplateLang,
    save,
    reset,
    openHistory,
    restoreVersion,
    loadLangConfig,
    toggleRuntimeLang,
    translateContent,
    exportTemplate,
    triggerImport,
    handleImport
  }
}
