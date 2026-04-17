<script setup lang="ts">
import { FileText } from 'lucide-vue-next'

defineProps<{
  wordCount: number
  lineCount: number
}>()
</script>

<template>
  <div class="flex items-center justify-between border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
    <div class="flex items-center space-x-4">
      <span>
        <FileText class="mr-1 inline h-3 w-3" />
        {{ wordCount }} 字
      </span>
      <span>{{ lineCount }} 行</span>
    </div>
    <div class="flex items-center space-x-2">
      <kbd class="rounded bg-muted px-1.5 py-0.5 text-xs">Ctrl+S</kbd>
      <span>保存</span>
      <kbd class="rounded bg-muted px-1.5 py-0.5 text-xs">Ctrl+Z</kbd>
      <span>撤销</span>
    </div>
  </div>
</template>
