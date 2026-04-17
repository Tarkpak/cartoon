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
  User,
  MessageSquare,
  MapPin,
  Loader2
} from 'lucide-vue-next'

defineProps<{
  canUndo: boolean
  canRedo: boolean
  parsing: boolean
  hasContent: boolean
}>()

defineEmits<{
  (event: 'action', action:
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
  ): void
}>()
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
    <div class="flex items-center space-x-1">
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        title="撤销 (Ctrl+Z)"
        :disabled="!canUndo"
        @click="$emit('action', 'undo')"
      >
        <Undo class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        title="重做 (Ctrl+Shift+Z)"
        :disabled="!canRedo"
        @click="$emit('action', 'redo')"
      >
        <Redo class="h-4 w-4" />
      </Button>

      <div class="mx-1 h-6 w-px bg-border" />

      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        title="加粗 (Ctrl+B)"
        @click="$emit('action', 'bold')"
      >
        <Bold class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        title="斜体 (Ctrl+I)"
        @click="$emit('action', 'italic')"
      >
        <Italic class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        title="引用"
        @click="$emit('action', 'quote')"
      >
        <Quote class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        title="标题1"
        @click="$emit('action', 'heading1')"
      >
        <Heading1 class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        title="标题2"
        @click="$emit('action', 'heading2')"
      >
        <Heading2 class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        title="列表"
        @click="$emit('action', 'list')"
      >
        <List class="h-4 w-4" />
      </Button>

      <div class="mx-1 h-6 w-px bg-border" />

      <Button
        variant="ghost"
        size="sm"
        class="h-8 text-xs"
        @click="$emit('action', 'dialogue')"
      >
        <MessageSquare class="mr-1 h-3 w-3" />
        对话
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-8 text-xs"
        @click="$emit('action', 'scene')"
      >
        <MapPin class="mr-1 h-3 w-3" />
        场景
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-8 text-xs"
        @click="$emit('action', 'character')"
      >
        <User class="mr-1 h-3 w-3" />
        角色
      </Button>
    </div>

    <div class="flex items-center space-x-2">
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        title="复制全文"
        @click="$emit('action', 'copy')"
      >
        <Copy class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        title="保存 (Ctrl+S)"
        @click="$emit('action', 'save')"
      >
        <Save class="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        :disabled="parsing || !hasContent"
        @click="$emit('action', 'parse')"
      >
        <Loader2
          v-if="parsing"
          class="mr-1 h-4 w-4 animate-spin"
        />
        <Sparkles
          v-else
          class="mr-1 h-4 w-4"
        />
        AI 解析
      </Button>
    </div>
  </div>
</template>
