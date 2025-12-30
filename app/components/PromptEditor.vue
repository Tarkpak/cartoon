<script setup lang="ts">
import {
  Save,
  RotateCcw,
  History,
  X,
  ChevronRight,
  Check,
  AlertCircle,
  Loader2,
  Plus,
  Eye
} from 'lucide-vue-next'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { PromptTemplate, PromptVersion, PromptVariable } from '#shared/types/prompt-template'

const props = defineProps<{
  template: PromptTemplate
}>()

const emit = defineEmits<{
  (e: 'update', template: PromptTemplate): void
  (e: 'saved'): void
}>()

// 状态
const activeLanguage = ref<'zh' | 'en'>('zh')
const saving = ref(false)
const resetting = ref(false)
const showHistory = ref(false)
const loadingVersions = ref(false)
const versions = ref<PromptVersion[]>([])
const previewMode = ref(false)
const previewVariables = ref<Record<string, string>>({})

// 本地编辑内容
const localContent = ref({
  zh: {
    systemPrompt: props.template.content.zh.systemPrompt || '',
    userPrompt: props.template.content.zh.userPrompt
  },
  en: {
    systemPrompt: props.template.content.en.systemPrompt || '',
    userPrompt: props.template.content.en.userPrompt
  }
})

// 当前编辑的是系统提示词还是用户提示词
const editingField = ref<'system' | 'user'>('user')

// 编辑器实例
const editor = useEditor({
  content: localContent.value[activeLanguage.value].userPrompt,
  extensions: [
    StarterKit,
    Placeholder.configure({
      placeholder: '输入提示词内容...'
    })
  ],
  editorProps: {
    attributes: {
      class: 'prose prose-sm max-w-none focus:outline-none min-h-[200px] p-4'
    }
  },
  onUpdate: ({ editor }) => {
    const html = editor.getHTML()
    // 将 HTML 转换为纯文本（保留换行）
    const text = htmlToText(html)
    if (editingField.value === 'system') {
      localContent.value[activeLanguage.value].systemPrompt = text
    } else {
      localContent.value[activeLanguage.value].userPrompt = text
    }
  }
})

// HTML 转纯文本
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p><p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// 纯文本转 HTML
function textToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n\n')
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// 切换语言时更新编辑器内容
watch(activeLanguage, (lang) => {
  updateEditorContent()
})

// 切换编辑字段时更新编辑器内容
watch(editingField, () => {
  updateEditorContent()
})

function updateEditorContent() {
  if (!editor.value) return
  const content = editingField.value === 'system'
    ? localContent.value[activeLanguage.value].systemPrompt
    : localContent.value[activeLanguage.value].userPrompt
  editor.value.commands.setContent(textToHtml(content || ''))
}

// 监听 props 变化
watch(() => props.template, (newTemplate) => {
  localContent.value = {
    zh: {
      systemPrompt: newTemplate.content.zh.systemPrompt || '',
      userPrompt: newTemplate.content.zh.userPrompt
    },
    en: {
      systemPrompt: newTemplate.content.en.systemPrompt || '',
      userPrompt: newTemplate.content.en.userPrompt
    }
  }
  updateEditorContent()
  // 初始化预览变量
  initPreviewVariables()
}, { immediate: true })

// 初始化预览变量
function initPreviewVariables() {
  const vars: Record<string, string> = {}
  for (const v of props.template.variables) {
    vars[v.name] = v.example || ''
  }
  previewVariables.value = vars
}

// 检查是否有修改
const hasChanges = computed(() => {
  const orig = props.template.content
  const local = localContent.value
  return (
    (orig.zh.systemPrompt || '') !== local.zh.systemPrompt ||
    orig.zh.userPrompt !== local.zh.userPrompt ||
    (orig.en.systemPrompt || '') !== local.en.systemPrompt ||
    orig.en.userPrompt !== local.en.userPrompt
  )
})

// 插入变量
function insertVariable(variable: PromptVariable) {
  if (!editor.value) return
  editor.value.commands.insertContent(`{{${variable.name}}}`)
}

// 保存
async function save() {
  saving.value = true
  try {
    const response = await $fetch(`/api/prompts/${props.template.id}`, {
      method: 'PUT',
      body: {
        content: localContent.value,
        note: `手动编辑 - ${new Date().toLocaleString('zh-CN')}`
      }
    })
    if ((response as any).success) {
      emit('update', (response as any).data)
      emit('saved')
    }
  } catch (e) {
    console.error('保存失败:', e)
  } finally {
    saving.value = false
  }
}

// 重置
async function reset() {
  if (!confirm('确定要重置此模板为默认值吗？')) return
  resetting.value = true
  try {
    const response = await $fetch(`/api/prompts/${props.template.id}/reset`, {
      method: 'POST'
    })
    if ((response as any).success) {
      emit('update', (response as any).data)
    }
  } catch (e) {
    console.error('重置失败:', e)
  } finally {
    resetting.value = false
  }
}

// 加载版本历史
async function loadVersions() {
  loadingVersions.value = true
  try {
    const response = await $fetch(`/api/prompts/${props.template.id}/versions`)
    if ((response as any).success) {
      versions.value = (response as any).data.versions
    }
  } catch (e) {
    console.error('加载版本历史失败:', e)
  } finally {
    loadingVersions.value = false
  }
}

// 打开历史面板
function openHistory() {
  showHistory.value = true
  loadVersions()
}

// 恢复版本
async function restoreVersion(versionId: string) {
  if (!confirm('确定要恢复到此版本吗？')) return
  try {
    const response = await $fetch(`/api/prompts/${props.template.id}/restore`, {
      method: 'POST',
      body: { versionId }
    })
    if ((response as any).success) {
      emit('update', (response as any).data)
      showHistory.value = false
    }
  } catch (e) {
    console.error('恢复版本失败:', e)
  }
}

// 预览内容
const previewContent = computed(() => {
  let content = localContent.value[activeLanguage.value].userPrompt
  for (const [key, value] of Object.entries(previewVariables.value)) {
    // key 已经是 {{variableName}} 格式，需要转义特殊字符后直接替换
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    content = content.replace(new RegExp(escapedKey, 'g'), value || `[${key}]`)
  }
  return content
})

// 格式化日期
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 获取变量标签显示文本
function getVariableTag(name: string): string {
  return `{{${name}}}`
}

// 分类颜色
const categoryColors: Record<string, string> = {
  text: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  image: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  video: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  audio: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
}

onMounted(() => {
  initPreviewVariables()
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 头部 -->
    <div class="flex-shrink-0 px-6 py-4 border-b">
      <div class="flex items-start justify-between gap-4">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="text-lg font-semibold">{{ template.name }}</h2>
            <span :class="['px-2 py-0.5 text-xs rounded', categoryColors[template.category]]">
              {{ { text: '文本', image: '图片', video: '视频', audio: '音频' }[template.category] }}
            </span>
            <span v-if="template.isCustomized" class="px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              已修改
            </span>
            <span v-if="hasChanges" class="px-2 py-0.5 text-xs rounded bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
              未保存
            </span>
          </div>
          <p class="text-sm text-muted-foreground mt-1">{{ template.description }}</p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" @click="openHistory">
            <History class="h-4 w-4 mr-1.5" />
            历史
          </Button>
          <Button variant="outline" size="sm" @click="reset" :disabled="resetting || !template.isCustomized">
            <Loader2 v-if="resetting" class="h-4 w-4 mr-1.5 animate-spin" />
            <RotateCcw v-else class="h-4 w-4 mr-1.5" />
            重置
          </Button>
          <Button size="sm" @click="save" :disabled="saving || !hasChanges">
            <Loader2 v-if="saving" class="h-4 w-4 mr-1.5 animate-spin" />
            <Save v-else class="h-4 w-4 mr-1.5" />
            保存
          </Button>
        </div>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="flex-1 overflow-hidden flex">
      <!-- 主编辑区 -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <!-- 语言切换 + 字段切换 -->
        <div class="flex-shrink-0 px-6 py-3 border-b flex items-center justify-between">
          <div class="flex gap-1 p-1 bg-muted rounded-lg">
            <button
              class="px-3 py-1.5 text-sm rounded-md transition-colors"
              :class="activeLanguage === 'zh' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'"
              @click="activeLanguage = 'zh'"
            >
              中文
            </button>
            <button
              class="px-3 py-1.5 text-sm rounded-md transition-colors"
              :class="activeLanguage === 'en' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'"
              @click="activeLanguage = 'en'"
            >
              English
            </button>
          </div>

          <div class="flex items-center gap-4">
            <div class="flex gap-1 p-1 bg-muted rounded-lg">
              <button
                class="px-3 py-1.5 text-sm rounded-md transition-colors"
                :class="editingField === 'user' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'"
                @click="editingField = 'user'"
              >
                用户提示词
              </button>
              <button
                class="px-3 py-1.5 text-sm rounded-md transition-colors"
                :class="editingField === 'system' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'"
                @click="editingField = 'system'"
              >
                系统提示词
              </button>
            </div>

            <button
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors"
              :class="previewMode ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'"
              @click="previewMode = !previewMode"
            >
              <Eye class="h-4 w-4" />
              预览
            </button>
          </div>
        </div>

        <!-- 编辑器 / 预览 -->
        <div class="flex-1 overflow-y-auto">
          <div v-if="!previewMode" class="h-full">
            <EditorContent :editor="editor" class="h-full" />
          </div>
          <div v-else class="p-6">
            <div class="p-4 rounded-lg bg-muted/50 border">
              <h4 class="text-sm font-medium mb-3">预览效果</h4>
              <div class="space-y-3">
                <div v-for="variable in template.variables" :key="variable.name" class="flex items-center gap-2">
                  <label class="text-sm text-muted-foreground w-32 flex-shrink-0">{{ variable.name }}:</label>
                  <input
                    v-model="previewVariables[variable.name]"
                    type="text"
                    class="flex-1 h-8 px-2 text-sm border rounded bg-background"
                    :placeholder="variable.example || '输入值...'"
                  />
                </div>
              </div>
              <div class="mt-4 p-4 rounded bg-background border">
                <pre class="text-sm whitespace-pre-wrap">{{ previewContent }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧变量面板 -->
      <div class="w-64 flex-shrink-0 border-l bg-muted/30 flex flex-col">
        <div class="flex-shrink-0 px-4 py-3 border-b">
          <h3 class="text-sm font-medium">可用变量</h3>
          <p class="text-xs text-muted-foreground mt-0.5">点击插入到编辑器</p>
        </div>
        <div class="flex-1 overflow-y-auto p-2">
          <div
            v-for="variable in template.variables"
            :key="variable.name"
            class="p-3 rounded-lg hover:bg-accent cursor-pointer transition-colors mb-2"
            @click="insertVariable(variable)"
          >
            <div class="flex items-center gap-2">
              <code class="px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary font-mono">
                {{ getVariableTag(variable.name) }}
              </code>
              <Plus class="h-3 w-3 text-muted-foreground" />
            </div>
            <p class="text-xs text-muted-foreground mt-1.5">{{ variable.description }}</p>
            <p v-if="variable.example" class="text-xs text-muted-foreground/70 mt-1 italic">
              例: {{ variable.example.slice(0, 50) }}{{ variable.example.length > 50 ? '...' : '' }}
            </p>
          </div>
          <div v-if="template.variables.length === 0" class="p-4 text-center text-sm text-muted-foreground">
            此模板没有变量
          </div>
        </div>
      </div>
    </div>

    <!-- 版本历史抽屉 -->
    <Teleport to="body">
      <Transition name="drawer">
        <div v-if="showHistory" class="fixed inset-0 z-50 flex justify-end">
          <div class="absolute inset-0 bg-black/50" @click="showHistory = false" />
          <div class="relative w-96 bg-background shadow-xl flex flex-col">
            <div class="flex items-center justify-between px-4 py-3 border-b">
              <h3 class="font-medium">版本历史</h3>
              <button class="p-1 rounded hover:bg-accent" @click="showHistory = false">
                <X class="h-4 w-4" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto">
              <div v-if="loadingVersions" class="flex items-center justify-center py-12">
                <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
              <div v-else-if="versions.length === 0" class="p-4 text-center text-sm text-muted-foreground">
                暂无版本历史
              </div>
              <div v-else class="divide-y">
                <div
                  v-for="version in versions"
                  :key="version.id"
                  class="p-4 hover:bg-accent/50 transition-colors"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium">{{ formatDate(version.createdAt) }}</p>
                      <p v-if="version.note" class="text-xs text-muted-foreground mt-0.5 truncate">
                        {{ version.note }}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" @click="restoreVersion(version.id)">
                      恢复
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}

.drawer-enter-active > div:last-child,
.drawer-leave-active > div:last-child {
  transition: transform 0.2s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from > div:last-child,
.drawer-leave-to > div:last-child {
  transform: translateX(100%);
}

:deep(.ProseMirror) {
  min-height: 200px;
  outline: none;
}

:deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: #adb5bd;
  pointer-events: none;
  height: 0;
}

:deep(.ProseMirror p) {
  margin: 0.5em 0;
}

:deep(.ProseMirror ul),
:deep(.ProseMirror ol) {
  padding-left: 1.5em;
}
</style>
