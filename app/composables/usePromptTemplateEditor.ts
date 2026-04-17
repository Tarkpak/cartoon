import { useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type {
  PromptTemplate,
  PromptVariable
} from '#shared/types/prompt-template'
import type { ProjectWorkflowType } from '#shared/types/project'
import {
  buildPromptDiffLines,
  buildPromptPreviewContent,
  extractPromptVariableName as extractVarName,
  getPromptVariableNameSet,
  getPromptVariableTag as getVariableTag,
  getPromptVariableValidation,
  promptHtmlToText,
  promptTextToHtml
} from '@/lib/prompt-editor'
import {
  buildPromptCharCount,
  buildPromptEditorContent,
  buildPromptPreviewVariables,
  hasPromptEditorChanges,
  type PromptEditorLanguage
} from '@/lib/prompt-template-editor'
import { createPromptVariableHighlight } from '@/lib/tiptap-variable-highlight'
import { usePromptTemplateEditorActions } from '@/composables/usePromptTemplateEditorActions'

interface UsePromptTemplateEditorOptions {
  template: Ref<PromptTemplate>
  workflow: Ref<ProjectWorkflowType | undefined>
  onUpdate: (template: PromptTemplate) => void
  onSaved: () => void
}

export function usePromptTemplateEditor(options: UsePromptTemplateEditorOptions) {
  const activeLanguage = ref<PromptEditorLanguage>('zh')
  const previewMode = ref(false)
  const previewVariables = ref<Record<string, string>>({})
  const isFullscreen = ref(false)
  const showDiff = ref(false)

  const currentWorkflow = computed<ProjectWorkflowType>(() => {
    return options.workflow.value || 'asset_consistency'
  })

  const localContent = ref(buildPromptEditorContent(options.template.value.content))

  const getValidVars = () => getPromptVariableNameSet(options.template.value.variables)

  const editor = useEditor({
    content: promptTextToHtml(localContent.value[activeLanguage.value]),
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: '输入提示词内容...'
      }),
      createPromptVariableHighlight(getValidVars)
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[200px] p-4'
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      localContent.value[activeLanguage.value] = promptHtmlToText(currentEditor.getHTML())
    }
  })

  function updateEditorContent() {
    if (!editor.value) return
    editor.value.commands.setContent(promptTextToHtml(localContent.value[activeLanguage.value] || ''))
  }

  function initPreviewVariables() {
    previewVariables.value = buildPromptPreviewVariables(options.template.value.variables)
  }

  const {
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
  } = usePromptTemplateEditorActions({
    template: options.template,
    workflow: currentWorkflow,
    localContent,
    activeLanguage,
    showDiff,
    onUpdate: options.onUpdate,
    onSaved: options.onSaved,
    updateEditorContent
  })

  watch(activeLanguage, updateEditorContent)

  watch(options.template, (newTemplate) => {
    localContent.value = buildPromptEditorContent(newTemplate.content)
    updateEditorContent()
    initPreviewVariables()
  }, { immediate: true })

  const hasChanges = computed(() => {
    return hasPromptEditorChanges(options.template.value.content, localContent.value)
  })

  const variableValidation = computed(() => {
    return getPromptVariableValidation(
      localContent.value[activeLanguage.value],
      options.template.value.variables
    )
  })

  const charCount = computed(() => {
    return buildPromptCharCount(localContent.value[activeLanguage.value], activeLanguage.value)
  })

  const diffLines = computed(() => {
    if (!showDiff.value) return []

    return buildPromptDiffLines(
      options.template.value.content[activeLanguage.value],
      localContent.value[activeLanguage.value]
    )
  })

  function undo() {
    editor.value?.commands.undo()
  }

  function redo() {
    editor.value?.commands.redo()
  }

  const canUndo = computed(() => editor.value?.can().undo() ?? false)
  const canRedo = computed(() => editor.value?.can().redo() ?? false)

  function insertVariable(variable: PromptVariable) {
    if (!editor.value) return
    editor.value.commands.insertContent(getVariableTag(extractVarName(variable.name)))
  }

  const previewContent = computed(() => {
    return buildPromptPreviewContent(
      localContent.value[activeLanguage.value],
      previewVariables.value
    )
  })

  function toggleFullscreen() {
    isFullscreen.value = !isFullscreen.value
  }

  function updatePreviewVariable(name: string, value: string) {
    previewVariables.value = {
      ...previewVariables.value,
      [name]: value
    }
  }

  function isVarUnused(varName: string): boolean {
    return variableValidation.value.unusedVars.includes(extractVarName(varName))
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      if (hasChanges.value) {
        void save()
      }
    }
  }

  onMounted(() => {
    initPreviewVariables()
    void loadLangConfig()
    window.addEventListener('keydown', handleKeydown)
  })

  onBeforeUnmount(() => {
    editor.value?.destroy()
    window.removeEventListener('keydown', handleKeydown)
  })

  return {
    activeLanguage,
    saving,
    resetting,
    showHistory,
    loadingVersions,
    versions,
    previewMode,
    previewVariables,
    isFullscreen,
    showDiff,
    langConfigSaving,
    translating,
    fileInputRef,
    currentTemplateLang,
    editor,
    hasChanges,
    variableValidation,
    charCount,
    diffLines,
    canUndo,
    canRedo,
    previewContent,
    undo,
    redo,
    insertVariable,
    save,
    reset,
    openHistory,
    restoreVersion,
    toggleRuntimeLang,
    translateContent,
    exportTemplate,
    triggerImport,
    handleImport,
    toggleFullscreen,
    updatePreviewVariable,
    isVarUnused
  }
}
