<script setup lang="ts">
import { Eye, Redo2, Undo2 } from 'lucide-vue-next'

defineProps<{
  readonly: boolean
  canUndo: boolean
  canRedo: boolean
  previewMode: boolean
  charCount: {
    chars: number
    tokens: number
  }
}>()

defineEmits<{
  (event: 'undo' | 'redo' | 'toggle-preview'): void
}>()
</script>

<template>
  <div class="flex flex-shrink-0 items-center justify-between gap-4 border-b px-6 py-3">
    <div class="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        :disabled="readonly || !canUndo"
        title="撤销 (Ctrl+Z)"
        @click="$emit('undo')"
      >
        <Undo2 class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        :disabled="readonly || !canRedo"
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
