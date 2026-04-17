<script setup lang="ts">
import { X, Loader2 } from 'lucide-vue-next'
import type { PromptVersion } from '#shared/types/prompt-template'
import { formatPromptVersionDate } from '@/lib/prompt-editor'

defineProps<{
  open: boolean
  loading: boolean
  versions: PromptVersion[]
}>()

const emit = defineEmits<{
  (e: 'update:open', open: boolean): void
  (e: 'restore', versionId: string): void
}>()
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex justify-end"
    @click.self="emit('update:open', false)"
  >
    <div
      class="absolute inset-0 bg-black/50"
      @click="emit('update:open', false)"
    />
    <div class="relative w-96 bg-background h-full shadow-xl flex flex-col">
      <div class="flex items-center justify-between p-4 border-b">
        <h3 class="font-semibold">
          版本历史
        </h3>
        <Button
          variant="ghost"
          size="icon"
          @click="emit('update:open', false)"
        >
          <X class="h-4 w-4" />
        </Button>
      </div>
      <div class="flex-1 overflow-auto p-4">
        <div
          v-if="loading"
          class="flex items-center justify-center py-8"
        >
          <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
        <div
          v-else-if="versions.length === 0"
          class="text-center py-8 text-muted-foreground"
        >
          暂无版本历史
        </div>
        <div
          v-else
          class="space-y-3"
        >
          <div
            v-for="version in versions"
            :key="version.id"
            class="p-3 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">
                  {{ formatPromptVersionDate(version.createdAt) }}
                </div>
                <div
                  v-if="version.note"
                  class="text-xs text-muted-foreground mt-0.5 truncate"
                >
                  {{ version.note }}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                @click="emit('restore', version.id)"
              >
                恢复
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
