<script setup lang="ts">
import {
  Loader2
} from 'lucide-vue-next'
import ScriptEditorStatusBar from '@/components/script/ScriptEditorStatusBar.vue'
import ScriptEditorToolbar from '@/components/script/ScriptEditorToolbar.vue'

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
    localValue.value = history.value[historyIndex.value] ?? ''
  }
}

// 重做
function redo() {
  if (historyIndex.value < history.value.length - 1) {
    historyIndex.value++
    localValue.value = history.value[historyIndex.value] ?? ''
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

function handleToolbarAction(action:
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'quote'
  | 'heading1'
  | 'heading2'
  | 'list'
  | 'dialogue'
  | 'scene'
  | 'character'
  | 'copy'
  | 'save'
  | 'parse'
) {
  if (action === 'undo') {
    undo()
    return
  }
  if (action === 'redo') {
    redo()
    return
  }
  if (action === 'bold') {
    formatBold()
    return
  }
  if (action === 'italic') {
    formatItalic()
    return
  }
  if (action === 'quote') {
    formatQuote()
    return
  }
  if (action === 'heading1') {
    formatHeading1()
    return
  }
  if (action === 'heading2') {
    formatHeading2()
    return
  }
  if (action === 'list') {
    formatList()
    return
  }
  if (action === 'dialogue') {
    insertDialogue()
    return
  }
  if (action === 'scene') {
    insertScene()
    return
  }
  if (action === 'character') {
    insertCharacter()
    return
  }
  if (action === 'copy') {
    void copyAll()
    return
  }
  if (action === 'save') {
    emit('save')
    return
  }
  emit('parse')
}
</script>

<template>
  <div class="border rounded-xl overflow-hidden bg-background">
    <ScriptEditorToolbar
      :can-undo="historyIndex > 0"
      :can-redo="historyIndex < history.length - 1"
      :parsing="parsing"
      :has-content="!!localValue.trim()"
      @action="handleToolbarAction"
    />

    <!-- 编辑区域 -->
    <div class="relative">
      <Textarea
        ref="editorRef"
        v-model="localValue"
        class="w-full min-h-[400px] p-4 resize-none bg-transparent font-mono text-sm leading-relaxed border-0 rounded-none shadow-none focus-visible:ring-0"
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

    <ScriptEditorStatusBar
      :word-count="wordCount"
      :line-count="lineCount"
    />
  </div>
</template>
