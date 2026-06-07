<script setup lang="ts">
import {
  AlertTriangle,
  FileText,
  TriangleAlert
} from 'lucide-vue-next'
import { EditorContent } from '@tiptap/vue-3'
import type { PromptTemplate } from '#shared/types/prompt-template'
import { getPromptVariableTag as getVariableTag } from '@/lib/prompt-editor'
import { usePromptTemplateEditor } from '@/composables/usePromptTemplateEditor'
import PromptEditorHeader from '@/components/prompt-editor/PromptEditorHeader.vue'
import PromptEditorToolbar from '@/components/prompt-editor/PromptEditorToolbar.vue'
import SettingsConfirmDialog from '@/components/settings/SettingsConfirmDialog.vue'

const props = defineProps<{
  template: PromptTemplate
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update', template: PromptTemplate): void
  (e: 'saved'): void
}>()

const template = toRef(props, 'template')
const readonly = toRef(props, 'readonly')

const {
  saving,
  resetting,
  showHistory,
  loadingVersions,
  versions,
  actionError,
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
} = usePromptTemplateEditor({
  template,
  readonly,
  onUpdate: nextTemplate => emit('update', nextTemplate),
  onSaved: () => emit('saved')
})

const resetConfirmOpen = ref(false)
const restoreConfirmOpen = ref(false)
const pendingRestoreVersionId = ref('')

function handleVariableInsert(variableName: string) {
  const variable = props.template.variables.find(item => item.name === variableName)
  if (!variable) return
  insertVariable(variable)
}

function requestReset() {
  actionError.value = ''
  resetConfirmOpen.value = true
}

function requestRestoreVersion(versionId: string) {
  actionError.value = ''
  pendingRestoreVersionId.value = versionId
  restoreConfirmOpen.value = true
}

async function confirmReset() {
  await reset()
  if (!actionError.value) {
    resetConfirmOpen.value = false
  }
}

async function confirmRestoreVersion() {
  if (!pendingRestoreVersionId.value) return
  await restoreVersion(pendingRestoreVersionId.value)
  if (!actionError.value) {
    restoreConfirmOpen.value = false
    pendingRestoreVersionId.value = ''
  }
}
</script>

<template>
  <div :class="['@container h-full flex flex-col', isFullscreen ? 'fixed inset-0 z-50 bg-background' : '']">
    <Input
      ref="fileInputRef"
      type="file"
      accept=".json"
      class="hidden"
      @change="handleImport"
    />

    <PromptEditorHeader
      :template="template"
      :has-changes="hasChanges"
      :readonly="isReadonly"
      :saving="saving"
      :resetting="resetting"
      :show-diff="showDiff"
      :is-fullscreen="isFullscreen"
      @trigger-import="triggerImport"
      @export="exportTemplate"
      @history="openHistory"
      @reset="requestReset"
      @toggle-diff="showDiff = !showDiff"
      @save="save"
      @toggle-fullscreen="toggleFullscreen"
    />

    <div
      v-if="actionError"
      class="flex flex-shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm text-destructive @lg:px-6"
    >
      <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
      <span class="min-w-0 flex-1 break-words">{{ actionError }}</span>
    </div>

    <!-- 主内容区 -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧编辑区 -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <PromptEditorToolbar
          :readonly="isReadonly"
          :can-undo="canUndo"
          :can-redo="canRedo"
          :preview-mode="previewMode"
          :char-count="charCount"
          @undo="undo"
          @redo="redo"
          @toggle-preview="previewMode = !previewMode"
        />

        <!-- 变量校验提示 -->
        <div
          v-if="!variableValidation.isValid || variableValidation.unusedVars.length > 0"
          class="flex-shrink-0 px-6 py-2 border-b bg-muted/30"
        >
          <div
            v-if="variableValidation.undefinedVars.length > 0"
            class="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle class="h-4 w-4 flex-shrink-0" />
            <span>未定义的变量: {{ variableValidation.undefinedVars.map(v => getVariableTag(v)).join(', ') }}</span>
          </div>
          <div
            v-if="variableValidation.unusedVars.length > 0"
            class="flex items-center gap-2 text-sm text-muted-foreground mt-1"
          >
            <FileText class="h-4 w-4 flex-shrink-0" />
            <span>未使用的变量: {{ variableValidation.unusedVars.map(v => getVariableTag(v)).join(', ') }}</span>
          </div>
        </div>

        <!-- 编辑器/预览/差异对比 -->
        <div class="flex-1 overflow-auto">
          <!-- 差异对比视图 -->
          <div
            v-if="showDiff"
            class="p-6 font-mono text-sm"
          >
            <div
              v-for="(line, idx) in diffLines"
              :key="idx"
              :class="[
                'px-2 py-0.5 whitespace-pre-wrap',
                line.type === 'add' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : '',
                line.type === 'remove' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' : ''
              ]"
            >
              <span class="inline-block w-6 text-muted-foreground">{{ line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ' }}</span>
              {{ line.content || ' ' }}
            </div>
          </div>
          <!-- 预览视图 -->
          <div
            v-else-if="previewMode"
            class="p-6"
          >
            <div class="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">
              {{ previewContent }}
            </div>
          </div>
          <!-- 编辑器 -->
          <EditorContent
            v-else
            :editor="editor"
            class="h-full"
          />
        </div>
      </div>

      <PromptEditorSidebar
        :template="template"
        :preview-mode="previewMode"
        :readonly="isReadonly"
        :preview-variables="previewVariables"
        :variable-validation="variableValidation"
        :is-var-unused="isVarUnused"
        @insert-variable="handleVariableInsert"
        @update-preview-variable="({ name, value }) => updatePreviewVariable(name, value)"
      />
    </div>

    <PromptEditorHistoryDrawer
      v-model:open="showHistory"
      :loading="loadingVersions"
      :versions="versions"
      @restore="requestRestoreVersion"
    />

    <SettingsConfirmDialog
      v-model:open="resetConfirmOpen"
      title="重置提示词模板"
      description="确定要将当前模板重置为默认内容吗？未保存的修改会被覆盖。"
      confirm-text="重置"
      :busy="resetting"
      :error="actionError"
      @confirm="confirmReset"
    />

    <SettingsConfirmDialog
      v-model:open="restoreConfirmOpen"
      title="恢复历史版本"
      description="确定要恢复到此历史版本吗？当前内容会被历史版本覆盖。"
      confirm-text="恢复"
      :error="actionError"
      @confirm="confirmRestoreVersion"
    />
  </div>
</template>

<style scoped>
:deep(.ProseMirror) {
  min-height: 100%;
  padding: 1.5rem;
  outline: none;
}

:deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: hsl(var(--muted-foreground));
  pointer-events: none;
  height: 0;
}

:deep(.ProseMirror p) {
  margin: 0.5em 0;
}

/* 变量高亮样式 */
:deep(.variable-tag) {
  display: inline;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, monospace;
  font-size: 0.875em;
  font-weight: 500;
}

:deep(.variable-tag.valid) {
  background-color: rgb(219 234 254); /* blue-100 */
  color: rgb(29 78 216); /* blue-700 */
  border: 1px solid rgb(147 197 253); /* blue-300 */
}

:deep(.variable-tag.invalid) {
  background-color: rgb(254 226 226); /* red-100 */
  color: rgb(185 28 28); /* red-700 */
  border: 1px solid rgb(252 165 165); /* red-300 */
}

/* 深色模式 */
:deep(.dark .variable-tag.valid),
.dark :deep(.variable-tag.valid) {
  background-color: rgb(30 58 138 / 0.3); /* blue-900/30 */
  color: rgb(147 197 253); /* blue-300 */
  border: 1px solid rgb(59 130 246 / 0.5); /* blue-500/50 */
}

:deep(.dark .variable-tag.invalid),
.dark :deep(.variable-tag.invalid) {
  background-color: rgb(127 29 29 / 0.3); /* red-900/30 */
  color: rgb(252 165 165); /* red-300 */
  border: 1px solid rgb(239 68 68 / 0.5); /* red-500/50 */
}
</style>
