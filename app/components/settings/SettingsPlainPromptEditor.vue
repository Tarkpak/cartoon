<script setup lang="ts">
import {
  FileUp,
  Loader2,
  RotateCcw,
  Save,
  TriangleAlert
} from 'lucide-vue-next'
import type { PromptTemplate } from '#shared/types/prompt-template'
import {
  resetPromptTemplate,
  savePromptTemplate
} from '@/lib/prompt-template-editor'
import SettingsConfirmDialog from '@/components/settings/SettingsConfirmDialog.vue'

const props = defineProps<{
  template: PromptTemplate
  readonly: boolean
}>()

const emit = defineEmits<{
  (event: 'update', template: PromptTemplate): void
}>()

const localContent = ref(props.template.content)
const saving = ref(false)
const resetting = ref(false)
const actionError = ref('')
const importError = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const resetConfirmOpen = ref(false)

watch(() => props.template, (template) => {
  localContent.value = template.content
  actionError.value = ''
  importError.value = ''
})

const hasChanges = computed(() => localContent.value !== props.template.content)
const isEmpty = computed(() => !localContent.value.trim())

function triggerImport() {
  if (props.readonly) return
  fileInputRef.value?.click()
}

async function handleImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  importError.value = ''
  try {
    localContent.value = await file.text()
  } catch {
    importError.value = '无法读取该文件，请使用 UTF-8 编码的 Markdown 或文本文件'
  }
}

async function save() {
  if (props.readonly || saving.value || !hasChanges.value || isEmpty.value) return
  saving.value = true
  actionError.value = ''

  try {
    const response = await savePromptTemplate({
      templateId: props.template.id,
      content: localContent.value
    })
    if (!response.success) {
      actionError.value = '保存提示词失败'
      return
    }
    emit('update', response.data)
    resetConfirmOpen.value = false
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '保存提示词失败'
  } finally {
    saving.value = false
  }
}

async function reset() {
  if (props.readonly || resetting.value || !props.template.isCustomized) return
  resetting.value = true
  actionError.value = ''

  try {
    const response = await resetPromptTemplate({ templateId: props.template.id })
    if (!response.success) {
      actionError.value = '恢复默认提示词失败'
      return
    }
    emit('update', response.data)
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '恢复默认提示词失败'
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <input
      ref="fileInputRef"
      type="file"
      accept=".md,.txt,text/markdown,text/plain"
      class="hidden"
      @change="handleImport"
    >

    <header class="flex flex-col gap-3 border-b px-4 py-4 md:flex-row md:items-start md:justify-between md:px-6">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-base font-semibold">
            {{ template.name }}
          </h2>
          <span
            v-if="hasChanges"
            class="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300"
          >
            未保存
          </span>
          <span
            v-else-if="readonly"
            class="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            系统默认
          </span>
          <span
            v-else-if="template.isCustomized"
            class="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300"
          >
            已自定义
          </span>
        </div>
        <p class="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          {{ template.description }}
        </p>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="readonly || saving || resetting"
          @click="triggerImport"
        >
          <FileUp class="mr-1.5 h-4 w-4" />
          导入提示词
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="readonly || saving || resetting || !template.isCustomized"
          @click="resetConfirmOpen = true"
        >
          <Loader2
            v-if="resetting"
            class="mr-1.5 h-4 w-4 animate-spin"
          />
          <RotateCcw
            v-else
            class="mr-1.5 h-4 w-4"
          />
          恢复默认
        </Button>
        <Button
          size="sm"
          :disabled="readonly || saving || resetting || !hasChanges || isEmpty"
          @click="save"
        >
          <Loader2
            v-if="saving"
            class="mr-1.5 h-4 w-4 animate-spin"
          />
          <Save
            v-else
            class="mr-1.5 h-4 w-4"
          />
          保存提示词
        </Button>
      </div>
    </header>

    <div
      v-if="actionError || importError || (hasChanges && isEmpty)"
      class="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm text-destructive md:px-6"
    >
      <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
      <span>{{ importError || actionError || '提示词内容不能为空' }}</span>
    </div>

    <div class="flex min-h-0 flex-1 flex-col px-4 py-4 md:px-6 md:pb-6">
      <Textarea
        v-model="localContent"
        :readonly="readonly"
        class="min-h-[18rem] flex-1 resize-none font-mono text-[13px] leading-6"
        placeholder="输入提示词正文，或导入 .md / .txt 文件"
        @keydown.ctrl.s.prevent="save"
        @keydown.meta.s.prevent="save"
      />
      <div class="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{{ readonly ? '默认配置只读' : '支持 Markdown 或纯文本' }}</span>
        <span class="tabular-nums">
          {{ localContent.length.toLocaleString('zh-CN') }} 个字符
        </span>
      </div>
    </div>

    <SettingsConfirmDialog
      v-model:open="resetConfirmOpen"
      title="恢复默认提示词"
      :description="`确定将「${template.name}」恢复为系统默认内容吗？`"
      confirm-text="恢复默认"
      :busy="resetting"
      :error="actionError"
      @confirm="reset"
    />
  </section>
</template>
