<script setup lang="ts">
import {
  Bold,
  Italic,
  Quote,
  List,
  Heading1,
  Heading2,
  Undo,
  Redo,
  Sparkles,
  Save,
  Copy,
  FileText,
  User,
  MessageSquare,
  MapPin,
  Loader2
} from 'lucide-vue-next'

interface ScriptEditorProps {
  modelValue: string
  placeholder?: string
  readonly?: boolean
  parsing?: boolean
}

const props = withDefaults(defineProps<ScriptEditorProps>(), {
  placeholder: '在此输入或粘贴小说文本...',
  readonly: false,
  parsing: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'parse': []
  'save': []
}>()

const editorRef = ref<HTMLTextAreaElement | null>(null)
const localValue = ref(props.modelValue)
const history = ref<string[]>([props.modelValue])
const historyIndex = ref(0)
const wordCount = computed(() => localValue.value.length)
const lineCount = computed(() => localValue.value.split('\n').length)

// 同步外部值
watch(() => props.modelValue, (val) => {
  if (val !== localValue.value) {
    localValue.value = val
  }
})

// 同步内部值
watch(localValue, (val) => {
  emit('update:modelValue', val)
})

// 保存历史记录
function saveHistory() {
  // 移除当前位置之后的历史
  history.value = history.value.slice(0, historyIndex.value + 1)
  history.value.push(localValue.value)
  historyIndex.value = history.value.length - 1

  // 限制历史记录数量
  if (history.value.length > 50) {
    history.value.shift()
    historyIndex.value--
  }
}

// 撤销
function undo() {
  if (historyIndex.value > 0) {
    historyIndex.value--
    localValue.value = history.value[historyIndex.value]
  }
}

// 重做
function redo() {
  if (historyIndex.value < history.value.length - 1) {
    historyIndex.value++
    localValue.value = history.value[historyIndex.value]
  }
}

// 插入文本
function insertText(before: string, after: string = '') {
  const textarea = editorRef.value
  if (!textarea) return

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selected = localValue.value.substring(start, end)

  const newText
    = localValue.value.substring(0, start)
      + before
      + selected
      + after
      + localValue.value.substring(end)

  localValue.value = newText
  saveHistory()

  // 恢复光标位置
  nextTick(() => {
    textarea.focus()
    textarea.setSelectionRange(
      start + before.length,
      start + before.length + selected.length
    )
  })
}

// 格式化操作
function formatBold() {
  insertText('**', '**')
}

function formatItalic() {
  insertText('*', '*')
}

function formatQuote() {
  insertText('\n> ')
}

function formatHeading1() {
  insertText('\n# ')
}

function formatHeading2() {
  insertText('\n## ')
}

function formatList() {
  insertText('\n- ')
}

// 插入模板
function insertDialogue() {
  insertText('\n"', '"')
}

function insertScene() {
  insertText('\n【场景：】\n')
}

function insertCharacter() {
  insertText('\n[角色：]')
}

function _insertNarration() {
  insertText('\n（旁白：）')
}

// 复制全文
async function copyAll() {
  try {
    await navigator.clipboard.writeText(localValue.value)
  } catch (e) {
    console.error('复制失败', e)
  }
}

// 键盘快捷键
function handleKeydown(e: KeyboardEvent) {
  // Ctrl/Cmd + S 保存
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    emit('save')
  }
  // Ctrl/Cmd + Z 撤销
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault()
    undo()
  }
  // Ctrl/Cmd + Shift + Z 重做
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
    e.preventDefault()
    redo()
  }
  // Ctrl/Cmd + B 加粗
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault()
    formatBold()
  }
  // Ctrl/Cmd + I 斜体
  if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
    e.preventDefault()
    formatItalic()
  }
}

// 输入时保存历史（防抖）
let saveTimer: ReturnType<typeof setTimeout> | null = null
function onInput() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveHistory, 500)
}
</script>

<template>
  <div class="border rounded-xl overflow-hidden bg-background">
    <!-- 工具栏 -->
    <div class="flex items-center justify-between px-3 py-2 border-b bg-muted/30 flex-wrap gap-2">
      <!-- 格式化按钮 -->
      <div class="flex items-center space-x-1">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          title="撤销 (Ctrl+Z)"
          :disabled="historyIndex <= 0"
          @click="undo"
        >
          <Undo class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          title="重做 (Ctrl+Shift+Z)"
          :disabled="historyIndex >= history.length - 1"
          @click="redo"
        >
          <Redo class="w-4 h-4" />
        </Button>

        <div class="w-px h-6 bg-border mx-1" />

        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          title="加粗 (Ctrl+B)"
          @click="formatBold"
        >
          <Bold class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          title="斜体 (Ctrl+I)"
          @click="formatItalic"
        >
          <Italic class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          title="引用"
          @click="formatQuote"
        >
          <Quote class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          title="标题1"
          @click="formatHeading1"
        >
          <Heading1 class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          title="标题2"
          @click="formatHeading2"
        >
          <Heading2 class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          title="列表"
          @click="formatList"
        >
          <List class="w-4 h-4" />
        </Button>

        <div class="w-px h-6 bg-border mx-1" />

        <!-- 快捷插入 -->
        <Button
          variant="ghost"
          size="sm"
          class="h-8 text-xs"
          @click="insertDialogue"
        >
          <MessageSquare class="w-3 h-3 mr-1" />
          对话
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 text-xs"
          @click="insertScene"
        >
          <MapPin class="w-3 h-3 mr-1" />
          场景
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 text-xs"
          @click="insertCharacter"
        >
          <User class="w-3 h-3 mr-1" />
          角色
        </Button>
      </div>

      <!-- 右侧操作 -->
      <div class="flex items-center space-x-2">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          title="复制全文"
          @click="copyAll"
        >
          <Copy class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          title="保存 (Ctrl+S)"
          @click="emit('save')"
        >
          <Save class="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          :disabled="parsing || !localValue.trim()"
          @click="emit('parse')"
        >
          <Loader2
            v-if="parsing"
            class="w-4 h-4 mr-1 animate-spin"
          />
          <Sparkles
            v-else
            class="w-4 h-4 mr-1"
          />
          AI 解析
        </Button>
      </div>
    </div>

    <!-- 编辑区域 -->
    <div class="relative">
      <textarea
        ref="editorRef"
        v-model="localValue"
        class="w-full min-h-[400px] p-4 resize-none focus:outline-none bg-transparent font-mono text-sm leading-relaxed"
        :placeholder="placeholder"
        :readonly="readonly"
        @keydown="handleKeydown"
        @input="onInput"
      />

      <!-- 解析中遮罩 -->
      <div
        v-if="parsing"
        class="absolute inset-0 bg-background/80 flex items-center justify-center"
      >
        <div class="text-center">
          <Loader2 class="w-8 h-8 mx-auto mb-2 animate-spin text-primary" />
          <p class="text-sm text-muted-foreground">
            AI 正在解析剧本...
          </p>
        </div>
      </div>
    </div>

    <!-- 状态栏 -->
    <div class="flex items-center justify-between px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
      <div class="flex items-center space-x-4">
        <span>
          <FileText class="w-3 h-3 inline mr-1" />
          {{ wordCount }} 字
        </span>
        <span>{{ lineCount }} 行</span>
      </div>
      <div class="flex items-center space-x-2">
        <kbd class="px-1.5 py-0.5 bg-muted rounded text-xs">Ctrl+S</kbd>
        <span>保存</span>
        <kbd class="px-1.5 py-0.5 bg-muted rounded text-xs">Ctrl+Z</kbd>
        <span>撤销</span>
      </div>
    </div>
  </div>
</template>
