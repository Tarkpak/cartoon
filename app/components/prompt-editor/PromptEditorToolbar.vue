<script setup lang="ts">
import { Eye, Languages, Loader2, Redo2, Undo2 } from 'lucide-vue-next'

defineProps<{
  activeLanguage: 'zh' | 'en'
  translating: boolean
  canUndo: boolean
  canRedo: boolean
  previewMode: boolean
  charCount: {
    chars: number
    tokens: number
  }
}>()

defineEmits<{
  (event: 'update:activeLanguage', value: 'zh' | 'en'): void
  (event: 'translate' | 'undo' | 'redo' | 'toggle-preview'): void
}>()
</script>

<template>
  <div class="flex flex-shrink-0 items-center justify-between gap-4 border-b px-6 py-3">
    <div class="flex items-center gap-2">
      <span class="text-sm text-muted-foreground">编辑语言:</span>
      <div class="flex overflow-hidden rounded-md border">
        <Button
          variant="ghost"
          size="sm"
          class="h-auto rounded-none px-3 py-1 text-sm transition-colors"
          :class="activeLanguage === 'zh' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
          @click="$emit('update:activeLanguage', 'zh')"
        >
          中文
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-auto rounded-none px-3 py-1 text-sm transition-colors"
          :class="activeLanguage === 'en' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'"
          @click="$emit('update:activeLanguage', 'en')"
        >
          English
        </Button>
      </div>

      <Button
        variant="outline"
        size="sm"
        class="ml-2"
        :disabled="translating"
        @click="$emit('translate')"
      >
        <Loader2
          v-if="translating"
          class="mr-1.5 h-4 w-4 animate-spin"
        />
        <Languages
          v-else
          class="mr-1.5 h-4 w-4"
        />
        {{ activeLanguage === 'zh' ? '翻译到英文' : '翻译到中文' }}
      </Button>

      <div class="mx-2 h-6 w-px bg-border" />

      <Button
        variant="ghost"
        size="icon"
        :disabled="!canUndo"
        title="撤销 (Ctrl+Z)"
        @click="$emit('undo')"
      >
        <Undo2 class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        :disabled="!canRedo"
        title="重做 (Ctrl+Y)"
        @click="$emit('redo')"
      >
        <Redo2 class="h-4 w-4" />
      </Button>
    </div>

    <div class="flex items-center gap-3">
      <div class="text-xs text-muted-foreground">
        {{ charCount.chars }} 字符 · ~{{ charCount.tokens }} tokens
      </div>

      <Button
        variant="ghost"
        size="sm"
        @click="$emit('toggle-preview')"
      >
        <Eye class="mr-1.5 h-4 w-4" />
        {{ previewMode ? '编辑' : '预览' }}
      </Button>
    </div>
  </div>
</template>
