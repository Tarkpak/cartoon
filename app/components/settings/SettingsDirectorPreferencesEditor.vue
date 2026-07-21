<script setup lang="ts">
import {
  FileUp,
  Loader2,
  Save,
  ShieldCheck,
  Sparkles
} from 'lucide-vue-next'
import {
  DIRECTOR_PREFERENCES_MAX_CHARS,
  hasDirectorPreferencesChanges,
  normalizeDirectorPreferences
} from '@/lib/director-preferences'

const props = defineProps<{
  content: string
  readonly: boolean
  saving: boolean
  error: string
}>()

const emit = defineEmits<{
  (event: 'create-profile'): void
  (event: 'save', content: string): void
}>()

const localContent = ref(props.content)
const importError = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

watch(() => props.content, (content) => {
  localContent.value = content
  importError.value = ''
})

const normalizedContent = computed(() => normalizeDirectorPreferences(localContent.value))
const hasChanges = computed(() => hasDirectorPreferencesChanges(normalizedContent.value, props.content))
const isOverLimit = computed(() => localContent.value.length > DIRECTOR_PREFERENCES_MAX_CHARS)
const usesSystemDefaults = computed(() => !normalizedContent.value && !hasChanges.value)

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
    const content = await file.text()
    if (content.length > DIRECTOR_PREFERENCES_MAX_CHARS) {
      importError.value = `文件内容超过 ${DIRECTOR_PREFERENCES_MAX_CHARS.toLocaleString('zh-CN')} 字符限制`
      return
    }
    localContent.value = content
  } catch {
    importError.value = '无法读取该文件，请改用 UTF-8 编码的 Markdown 或文本文件'
  }
}

function save() {
  if (props.readonly || props.saving || !hasChanges.value || isOverLimit.value) return
  emit('save', localContent.value)
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
          <Sparkles class="h-4 w-4 text-primary" />
          <h2 class="text-base font-semibold">
            分镜提示词
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
            v-else-if="usesSystemDefaults"
            class="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            未添加额外偏好
          </span>
        </div>
        <p class="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          {{ readonly
            ? '这是当前生效的系统默认分镜提示词；新建方案后可在副本上修改。'
            : usesSystemDefaults
              ? '当前方案内容为空，将使用系统默认分镜提示词。'
              : '这份提示词将直接用于剧本的分镜解析。' }}
        </p>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          v-if="readonly"
          size="sm"
          @click="emit('create-profile')"
        >
          新建方案并修改
        </Button>
        <template v-else>
          <Button
            variant="outline"
            size="sm"
            :disabled="saving"
            @click="triggerImport"
          >
            <FileUp class="mr-1.5 h-4 w-4" />
            导入提示词
          </Button>
          <Button
            size="sm"
            :disabled="saving || !hasChanges || isOverLimit"
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
        </template>
      </div>
    </header>

    <div class="flex items-start gap-2 border-b bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground md:px-6">
      <ShieldCheck class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span>输入输出格式、资产字段和时长规则由系统保护，这里只控制分镜风格、节奏与镜头表达。</span>
    </div>

    <div
      v-if="error || importError || isOverLimit"
      class="border-b border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm text-destructive md:px-6"
    >
      {{ importError || error || `内容不能超过 ${DIRECTOR_PREFERENCES_MAX_CHARS.toLocaleString('zh-CN')} 个字符` }}
    </div>

    <div class="flex min-h-0 flex-1 flex-col px-4 py-4 md:px-6 md:pb-6">
      <Textarea
        v-model="localContent"
        :readonly="readonly"
        class="min-h-[18rem] flex-1 resize-none font-mono text-[13px] leading-6"
        :placeholder="readonly
          ? '默认方案使用系统内置提示词，无额外自定义内容'
          : '粘贴你的分镜提示词，或导入 .md / .txt 文件'"
        @keydown.ctrl.s.prevent="save"
        @keydown.meta.s.prevent="save"
      />
      <div class="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{{ readonly ? '默认配置只读' : '支持 Markdown 或纯文本' }}</span>
        <span class="tabular-nums" :class="isOverLimit ? 'text-destructive' : ''">
          {{ localContent.length.toLocaleString('zh-CN') }} / {{ DIRECTOR_PREFERENCES_MAX_CHARS.toLocaleString('zh-CN') }}
        </span>
      </div>
    </div>
  </section>
</template>
