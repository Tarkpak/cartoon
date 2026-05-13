import { useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type {
  PromptTemplate,
  PromptVariable
} from '#shared/types/prompt-template'
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
  hasPromptEditorChanges
} from '@/lib/prompt-template-editor'
import { createPromptVariableHighlight } from '@/lib/tiptap-variable-highlight'
import { usePromptTemplateEditorActions } from '@/composables/usePromptTemplateEditorActions'

interface UsePromptTemplateEditorOptions {
  template: Ref<PromptTemplate>
  readonly: Ref<boolean | undefined>
  onUpdate: (template: PromptTemplate) => void
  onSaved: () => void
}

export function usePromptTemplateEditor(options: UsePromptTemplateEditorOptions) {
  const previewMode = ref(false)
  const previewVariables = ref<Record<string, string>>({})
  const isFullscreen = ref(false)
  const showDiff = ref(false)

  const isReadonly = computed(() => options.readonly.value === true)

  const localContent = ref(buildPromptEditorContent(options.template.value.content))

  const getValidVars = () => getPromptVariableNameSet(options.template.value.variables)

  const editor = useEditor({
    editable: !isReadonly.value,
    content: promptTextToHtml(localContent.value),
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
      localContent.value = promptHtmlToText(currentEditor.getHTML())
    }
  })

  function updateEditorContent() {
    if (!editor.value) return
    editor.value.commands.setContent(promptTextToHtml(localContent.value || ''))
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
    fileInputRef,
    save,
    reset,
    openHistory,
    restoreVersion,
    exportTemplate,
    triggerImport,
    handleImport
  } = usePromptTemplateEditorActions({
    template: options.template,
    localContent,
    showDiff,
    onUpdate: options.onUpdate,
    onSaved: options.onSaved,
    isReadonly,
    updateEditorContent
  })

  watch(isReadonly, (value) => {
    editor.value?.setEditable(!value)
  })

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
      localContent.value,
      options.template.value.variables
    )
  })

  const charCount = computed(() => {
    return buildPromptCharCount(localContent.value)
  })

  const diffLines = computed(() => {
    if (!showDiff.value) return []

    return buildPromptDiffLines(
      options.template.value.content,
      localContent.value
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
      localContent.value,
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
      if (hasChanges.value && !isReadonly.value) {
        void save()
      }
    }
  }

  onMounted(() => {
    initPreviewVariables()
    window.addEventListener('keydown', handleKeydown)
  })

  onBeforeUnmount(() => {
    editor.value?.destroy()
    window.removeEventListener('keydown', handleKeydown)
  })

  return {
    saving,
    resetting,
    showHistory,
    loadingVersions,
    versions,
    previewMode,
    previewVariables,
    isFullscreen,
    showDiff,
    isReadonly,
    fileInputRef,
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
    exportTemplate,
    triggerImport,
    handleImport,
    toggleFullscreen,
    updatePreviewVariable,
    isVarUnused
  }
}
