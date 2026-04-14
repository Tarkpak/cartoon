<script setup lang="ts">
import {
  Save,
  RotateCcw,
  History,
  X,
  Loader2,
  Plus,
  Eye,
  Globe,
  Languages,
  Undo2,
  Redo2,
  Maximize2,
  Minimize2,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Download,
  Upload,
  GitCompare
} from 'lucide-vue-next'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { PromptTemplate, PromptVersion, PromptVariable } from '#shared/types/prompt-template'
import type { ProjectWorkflowType } from '#shared/types/project'

// 变量高亮插件 - 使用 Decoration 实时高亮
function createVariableHighlightPlugin(getValidVars: () => Set<string>) {
  return new Plugin({
    key: new PluginKey('variableHighlight'),
    state: {
      init(_, { doc }) {
        return findVariables(doc, getValidVars())
      },
      apply(tr, oldState) {
        if (tr.docChanged) {
          return findVariables(tr.doc, getValidVars())
        }
        return oldState
      }
    },
    props: {
      decorations(state) {
        return this.getState(state)
      }
    }
  })
}

function findVariables(doc: any, validVars: Set<string>): DecorationSet {
  const decorations: Decoration[] = []
  const regex = /\{\{(\w+)\}\}/g
  
  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return
    
    const text = node.text || ''
    let match
    
    while ((match = regex.exec(text)) !== null) {
      const start = pos + match.index
      const end = start + match[0].length
      const varName = match[1]
      if (!varName) continue
      const isValid = validVars.has(varName)
      
      decorations.push(
        Decoration.inline(start, end, {
          class: isValid ? 'variable-tag valid' : 'variable-tag invalid',
          'data-variable': varName
        })
      )
    }
  })
  
  return DecorationSet.create(doc, decorations)
}

// 创建变量高亮扩展
const createVariableHighlight = (getValidVars: () => Set<string>) => {
  return Extension.create({
    name: 'variableHighlight',
    addProseMirrorPlugins() {
      return [createVariableHighlightPlugin(getValidVars)]
    }
  })
}

const props = defineProps<{
  template: PromptTemplate
  workflow?: ProjectWorkflowType
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
const isFullscreen = ref(false)
const showDiff = ref(false)
const currentWorkflow = computed<ProjectWorkflowType>(() => props.workflow || 'classic')

// 语言配置状态
const langConfig = ref<Record<string, 'zh' | 'en'>>({})
const langConfigSaving = ref(false)
const translating = ref(false)

// 文件导入
const fileInputRef = ref<HTMLInputElement | null>(null)

// 当前模板使用的语言
const currentTemplateLang = computed({
  get: () => langConfig.value[props.template.id] || 'zh',
  set: (val) => {
    langConfig.value[props.template.id] = val
  }
})

// 本地编辑内容
const localContent = ref({
  zh: props.template.content.zh || '',
  en: props.template.content.en || ''
})

// 获取有效变量名集合
const getValidVars = () => {
  return new Set(props.template.variables.map(v => {
    const match = v.name.match(/\{\{(\w+)\}\}/)
    return match?.[1] ?? v.name
  }))
}

// 编辑器实例
const editor = useEditor({
  content: textToHtml(localContent.value[activeLanguage.value]),
  extensions: [
    StarterKit,
    Placeholder.configure({
      placeholder: '输入提示词内容...'
    }),
    createVariableHighlight(getValidVars)
  ],
  editorProps: {
    attributes: {
      class: 'prose prose-sm max-w-none focus:outline-none min-h-[200px] p-4'
    }
  },
  onUpdate: ({ editor: ed }) => {
    const text = ed.getText()
    // 保留换行
    const html = ed.getHTML()
    localContent.value[activeLanguage.value] = htmlToText(html)
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

// 纯文本转 HTML（不需要高亮，Decoration 会处理）
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  
  return escaped
    .split('\n\n')
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// 切换语言时更新编辑器内容
watch(activeLanguage, () => {
  updateEditorContent()
})

function updateEditorContent() {
  if (!editor.value) return
  const content = localContent.value[activeLanguage.value]
  editor.value.commands.setContent(textToHtml(content || ''))
}

// 监听 props 变化
watch(() => props.template, (newTemplate) => {
  localContent.value = {
    zh: newTemplate.content.zh || '',
    en: newTemplate.content.en || ''
  }
  updateEditorContent()
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
  return orig.zh !== local.zh || orig.en !== local.en
})

// 变量校验
const variableValidation = computed(() => {
  const content = localContent.value[activeLanguage.value]
  // 从变量定义中提取实际变量名（去掉 {{ 和 }}）
  const definedVars = new Set(props.template.variables.map(v => {
    const match = v.name.match(/\{\{(\w+)\}\}/)
    return match?.[1] ?? v.name
  }))
  const usedVars = new Set<string>()
  
  // 提取使用的变量
  const regex = /\{\{(\w+)\}\}/g
  let match
  while ((match = regex.exec(content)) !== null) {
    const varName = match[1]
    if (varName) usedVars.add(varName)
  }
  
  // 未定义但使用的变量
  const undefinedVars = [...usedVars].filter(v => !definedVars.has(v))
  // 已定义但未使用的变量
  const unusedVars = [...definedVars].filter(v => !usedVars.has(v))
  
  return { undefinedVars, unusedVars, isValid: undefinedVars.length === 0 }
})

// 字数统计
const charCount = computed(() => {
  const content = localContent.value[activeLanguage.value]
  return {
    chars: content.length,
    words: content.trim() ? content.trim().split(/\s+/).length : 0,
    // 粗略估算 token（中文约 2 字符/token，英文约 4 字符/token）
    tokens: Math.ceil(content.length / (activeLanguage.value === 'zh' ? 2 : 4))
  }
})

// Diff 计算
const diffLines = computed(() => {
  if (!showDiff.value) return []
  
  const original = props.template.content[activeLanguage.value].split('\n')
  const current = localContent.value[activeLanguage.value].split('\n')
  const result: Array<{ type: 'same' | 'add' | 'remove', content: string }> = []
  
  // 简单的逐行对比
  const maxLen = Math.max(original.length, current.length)
  for (let i = 0; i < maxLen; i++) {
    const origLine = original[i] ?? ''
    const currLine = current[i] ?? ''
    
    if (origLine === currLine) {
      result.push({ type: 'same', content: currLine })
    } else {
      if (origLine) result.push({ type: 'remove', content: origLine })
      if (currLine) result.push({ type: 'add', content: currLine })
    }
  }
  
  return result
})

// 撤销/重做
function undo() {
  editor.value?.commands.undo()
}

function redo() {
  editor.value?.commands.redo()
}

const canUndo = computed(() => editor.value?.can().undo() ?? false)
const canRedo = computed(() => editor.value?.can().redo() ?? false)

// 插入变量
function insertVariable(variable: PromptVariable) {
  if (!editor.value) return
  const pureName = extractVarName(variable.name)
  const varTag = '\u007B\u007B' + pureName + '\u007D\u007D'
  // 直接插入文本，Decoration 会自动高亮
  editor.value.commands.insertContent(varTag)
}

// 保存
async function save() {
  saving.value = true
  try {
    const response = await $fetch(`/api/prompts/${props.template.id}`, {
      method: 'PUT',
      query: { workflow: currentWorkflow.value },
      body: {
        content: localContent.value,
        note: `手动编辑 - ${new Date().toLocaleString('zh-CN')}`
      }
    })
    if ((response as any).success) {
      emit('update', (response as any).data)
      emit('saved')
      showDiff.value = false
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
      method: 'POST',
      query: { workflow: currentWorkflow.value }
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
    const response = await $fetch(`/api/prompts/${props.template.id}/versions`, {
      query: { workflow: currentWorkflow.value }
    })
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
      query: { workflow: currentWorkflow.value },
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
  let content = localContent.value[activeLanguage.value]
  for (const [key, value] of Object.entries(previewVariables.value)) {
    const placeholder = '{{' + key + '}}'
    content = content.split(placeholder).join(value || `[${key}]`)
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

// 加载语言配置
async function loadLangConfig() {
  try {
    const response = await $fetch<{ success: boolean; data: Record<string, 'zh' | 'en'> }>('/api/prompts/lang-config', {
      query: { workflow: currentWorkflow.value }
    })
    if (response.success && response.data) {
      langConfig.value = response.data
    }
  } catch (e) {
    console.error('加载语言配置失败:', e)
  }
}

// 保存语言配置
async function saveLangConfig() {
  langConfigSaving.value = true
  try {
    await $fetch('/api/prompts/lang-config', {
      method: 'PUT',
      query: { workflow: currentWorkflow.value },
      body: { [props.template.id]: currentTemplateLang.value }
    })
  } catch (e) {
    console.error('保存语言配置失败:', e)
  } finally {
    langConfigSaving.value = false
  }
}

// 切换运行时语言
async function toggleRuntimeLang(lang: 'zh' | 'en') {
  currentTemplateLang.value = lang
  await saveLangConfig()
}

// 翻译当前内容到另一种语言
async function translateContent() {
  const fromLang = activeLanguage.value
  const toLang = fromLang === 'zh' ? 'en' : 'zh'
  const sourceText = localContent.value[fromLang]
  
  if (!sourceText.trim()) return
  
  translating.value = true
  try {
    const response = await $fetch<{ success: boolean; data: { translatedText: string } }>('/api/prompts/translate', {
      method: 'POST',
      body: { text: sourceText, from: fromLang, to: toLang }
    })
    
    if (response.success && response.data?.translatedText) {
      localContent.value[toLang] = response.data.translatedText
    }
  } catch (e) {
    console.error('翻译失败:', e)
  } finally {
    translating.value = false
  }
}

// 导出当前模板
function exportTemplate() {
  const data = {
    id: props.template.id,
    name: props.template.name,
    content: localContent.value,
    exportedAt: new Date().toISOString()
  }
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `prompt-${props.template.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// 导入模板
function triggerImport() {
  fileInputRef.value?.click()
}

function handleImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target?.result as string)
      if (data.content?.zh) localContent.value.zh = data.content.zh
      if (data.content?.en) localContent.value.en = data.content.en
      updateEditorContent()
    } catch (err) {
      console.error('导入失败:', err)
      alert('导入失败：文件格式不正确')
    }
  }
  reader.readAsText(file)
  input.value = ''
}

// 全屏切换
function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

// 获取变量标签显示文本（使用 Unicode 转义避免 Vue 模板解析）
function getVariableTag(name: string): string {
  // 如果已经是 {{name}} 格式，直接返回
  if (name.startsWith('{{') && name.endsWith('}}')) {
    return name
  }
  return '\u007B\u007B' + name + '\u007D\u007D'
}

// 从变量名中提取纯名称（去掉 {{ 和 }}）
function extractVarName(name: string): string {
  const match = name.match(/\{\{(\w+)\}\}/)
  return match?.[1] ?? name
}

// 检查变量是否未使用
function isVarUnused(varName: string): boolean {
  const pureName = extractVarName(varName)
  return variableValidation.value.unusedVars.includes(pureName)
}

// 分类颜色
const categoryColors: Record<string, string> = {
  text: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  image: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  video: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  audio: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
}

// 快捷键
function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    if (hasChanges.value) save()
  }
}

onMounted(() => {
  initPreviewVariables()
  loadLangConfig()
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  editor.value?.destroy()
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div :class="['h-full flex flex-col', isFullscreen ? 'fixed inset-0 z-50 bg-background' : '']">
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
          <!-- 导入导出 -->
          <input ref="fileInputRef" type="file" accept=".json" class="hidden" @change="handleImport" />
          <Button variant="ghost" size="icon" @click="triggerImport" title="导入">
            <Upload class="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" @click="exportTemplate" title="导出">
            <Download class="h-4 w-4" />
          </Button>
          <div class="w-px h-6 bg-border mx-1" />
          
          <Button variant="outline" size="sm" @click="openHistory">
            <History class="h-4 w-4 mr-1.5" />
            历史
          </Button>
          <Button variant="outline" size="sm" @click="reset" :disabled="resetting || !template.isCustomized">
            <Loader2 v-if="resetting" class="h-4 w-4 mr-1.5 animate-spin" />
            <RotateCcw v-else class="h-4 w-4 mr-1.5" />
            重置
          </Button>
          <Button v-if="hasChanges" variant="outline" size="sm" @click="showDiff = !showDiff">
            <GitCompare class="h-4 w-4 mr-1.5" />
            {{ showDiff ? '隐藏差异' : '查看差异' }}
          </Button>
          <Button size="sm" @click="save" :disabled="saving || !hasChanges">
            <Loader2 v-if="saving" class="h-4 w-4 mr-1.5 animate-spin" />
            <Save v-else class="h-4 w-4 mr-1.5" />
            保存
          </Button>
          <Button variant="ghost" size="icon" @click="toggleFullscreen" :title="isFullscreen ? '退出全屏' : '全屏编辑'">
            <Minimize2 v-if="isFullscreen" class="h-4 w-4" />
            <Maximize2 v-else class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧编辑区 -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <!-- 工具栏 -->
        <div class="flex-shrink-0 px-6 py-3 border-b flex items-center justify-between gap-4">
          <div class="flex items-center gap-2">
            <!-- 语言切换 -->
            <span class="text-sm text-muted-foreground">编辑语言:</span>
            <div class="flex rounded-md border overflow-hidden">
              <Button
                variant="ghost"
                size="sm"
                class="px-3 py-1 h-auto rounded-none text-sm transition-colors"
                :class="activeLanguage === 'zh' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
                @click="activeLanguage = 'zh'"
              >
                中文
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="px-3 py-1 h-auto rounded-none text-sm transition-colors"
                :class="activeLanguage === 'en' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
                @click="activeLanguage = 'en'"
              >
                English
              </Button>
            </div>
            
            <!-- 翻译 -->
            <Button variant="outline" size="sm" @click="translateContent" :disabled="translating" class="ml-2">
              <Loader2 v-if="translating" class="h-4 w-4 mr-1.5 animate-spin" />
              <Languages v-else class="h-4 w-4 mr-1.5" />
              {{ activeLanguage === 'zh' ? '翻译到英文' : '翻译到中文' }}
            </Button>
            
            <div class="w-px h-6 bg-border mx-2" />
            
            <!-- 撤销/重做 -->
            <Button variant="ghost" size="icon" @click="undo" :disabled="!canUndo" title="撤销 (Ctrl+Z)">
              <Undo2 class="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" @click="redo" :disabled="!canRedo" title="重做 (Ctrl+Y)">
              <Redo2 class="h-4 w-4" />
            </Button>
          </div>
          
          <div class="flex items-center gap-3">
            <!-- 字数统计 -->
            <div class="text-xs text-muted-foreground">
              {{ charCount.chars }} 字符 · ~{{ charCount.tokens }} tokens
            </div>
            
            <!-- 预览切换 -->
            <Button variant="ghost" size="sm" @click="previewMode = !previewMode">
              <Eye class="h-4 w-4 mr-1.5" />
              {{ previewMode ? '编辑' : '预览' }}
            </Button>
          </div>
        </div>

        <!-- 变量校验提示 -->
        <div v-if="!variableValidation.isValid || variableValidation.unusedVars.length > 0" class="flex-shrink-0 px-6 py-2 border-b bg-muted/30">
          <div v-if="variableValidation.undefinedVars.length > 0" class="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle class="h-4 w-4 flex-shrink-0" />
            <span>未定义的变量: {{ variableValidation.undefinedVars.map(v => getVariableTag(v)).join(', ') }}</span>
          </div>
          <div v-if="variableValidation.unusedVars.length > 0" class="flex items-center gap-2 text-sm text-muted-foreground mt-1">
            <FileText class="h-4 w-4 flex-shrink-0" />
            <span>未使用的变量: {{ variableValidation.unusedVars.map(v => getVariableTag(v)).join(', ') }}</span>
          </div>
        </div>

        <!-- 编辑器/预览/差异对比 -->
        <div class="flex-1 overflow-auto">
          <!-- 差异对比视图 -->
          <div v-if="showDiff" class="p-6 font-mono text-sm">
            <div v-for="(line, idx) in diffLines" :key="idx" :class="[
              'px-2 py-0.5 whitespace-pre-wrap',
              line.type === 'add' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : '',
              line.type === 'remove' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' : ''
            ]">
              <span class="inline-block w-6 text-muted-foreground">{{ line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ' }}</span>
              {{ line.content || ' ' }}
            </div>
          </div>
          <!-- 预览视图 -->
          <div v-else-if="previewMode" class="p-6">
            <div class="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">{{ previewContent }}</div>
          </div>
          <!-- 编辑器 -->
          <EditorContent v-else :editor="editor" class="h-full" />
        </div>
      </div>

      <!-- 右侧面板 -->
      <div class="w-72 flex-shrink-0 border-l flex flex-col overflow-hidden">
        <!-- 运行时语言配置 -->
        <div class="p-4 border-b">
          <div class="flex items-center gap-2 mb-2">
            <Globe class="h-4 w-4 text-muted-foreground" />
            <span class="text-sm font-medium">运行时语言</span>
          </div>
          <p class="text-xs text-muted-foreground mb-2">实际调用 AI 时使用的语言版本</p>
          <div class="flex rounded-md border overflow-hidden">
            <Button
              variant="ghost"
              size="sm"
              class="flex-1 px-3 py-1.5 h-auto rounded-none text-sm transition-colors"
              :class="currentTemplateLang === 'zh' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
              :disabled="langConfigSaving"
              @click="toggleRuntimeLang('zh')"
            >
              中文
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="flex-1 px-3 py-1.5 h-auto rounded-none text-sm transition-colors"
              :class="currentTemplateLang === 'en' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
              :disabled="langConfigSaving"
              @click="toggleRuntimeLang('en')"
            >
              English
            </Button>
          </div>
        </div>

        <!-- 可用变量 -->
        <div class="flex-1 overflow-auto p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <Plus class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-medium">可用变量</span>
            </div>
            <span v-if="variableValidation.isValid" class="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle2 class="h-3 w-3" />
              校验通过
            </span>
          </div>
          <div class="space-y-2">
            <div
              v-for="variable in template.variables"
              :key="variable.name"
              class="group"
            >
              <Button
                variant="ghost"
                size="sm"
                :class="[
                  'w-full h-auto justify-start text-left p-2 rounded border transition-colors',
                  isVarUnused(variable.name) 
                    ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20' 
                    : 'hover:bg-muted'
                ]"
                @click="insertVariable(variable)"
              >
                <code class="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{{ getVariableTag(variable.name) }}</code>
                <p class="text-xs text-muted-foreground mt-1">{{ variable.description }}</p>
                <p v-if="variable.example" class="text-xs text-muted-foreground/70 mt-0.5 truncate">
                  示例: {{ variable.example }}
                </p>
              </Button>
            </div>
          </div>
        </div>

        <!-- 预览变量值 -->
        <div v-if="previewMode" class="border-t p-4">
          <div class="text-sm font-medium mb-2">预览变量值</div>
          <div class="space-y-2 max-h-40 overflow-auto">
            <div v-for="variable in template.variables" :key="variable.name">
              <label class="text-xs text-muted-foreground">{{ variable.name }}</label>
              <Input
                v-model="previewVariables[variable.name]"
                :placeholder="variable.example"
                class="h-7 text-xs"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 版本历史抽屉 -->
    <div
      v-if="showHistory"
      class="fixed inset-0 z-50 flex justify-end"
      @click.self="showHistory = false"
    >
      <div class="absolute inset-0 bg-black/50" @click="showHistory = false" />
      <div class="relative w-96 bg-background h-full shadow-xl flex flex-col">
        <div class="flex items-center justify-between p-4 border-b">
          <h3 class="font-semibold">版本历史</h3>
          <Button variant="ghost" size="icon" @click="showHistory = false">
            <X class="h-4 w-4" />
          </Button>
        </div>
        <div class="flex-1 overflow-auto p-4">
          <div v-if="loadingVersions" class="flex items-center justify-center py-8">
            <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
          <div v-else-if="versions.length === 0" class="text-center py-8 text-muted-foreground">
            暂无版本历史
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="version in versions"
              :key="version.id"
              class="p-3 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium">{{ formatDate(version.createdAt) }}</div>
                  <div v-if="version.note" class="text-xs text-muted-foreground mt-0.5 truncate">
                    {{ version.note }}
                  </div>
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
