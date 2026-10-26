<script setup lang="ts">
import { X, Loader2 } from 'lucide-vue-next'
import { onKeyStroke } from '@vueuse/core'
import type { PromptVersion } from '#shared/types/prompt-template'
import { formatPromptVersionDate } from '@/lib/prompt-editor'

const props = defineProps<{
  open: boolean
  loading: boolean
  versions: PromptVersion[]
}>()

const emit = defineEmits<{
  (e: 'update:open', open: boolean): void
  (e: 'restore', versionId: string): void
}>()

onKeyStroke('Escape', () => {
  if (props.open) emit('update:open', false)
})
</script>

<template>
  <Transition name="history-drawer">
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex justify-end"
    role="dialog"
    aria-modal="true"
    aria-label="版本历史"
    @click.self="emit('update:open', false)"
  >
    <div
      class="absolute inset-0 bg-black/40 backdrop-blur-[2px] dark:bg-black/60"
      @click="emit('update:open', false)"
    />
    <div class="history-panel relative flex h-full w-96 max-w-[calc(100vw-2rem)] flex-col bg-popover shadow-[-16px_0_48px_rgb(0_0_0/0.18)]">
      <div class="flex items-center justify-between p-4 border-b">
        <h3 class="font-semibold">
          版本历史
        </h3>
        <IconActionButton
          label="关闭"
          @click="emit('update:open', false)"
        >
          <X class="h-4 w-4" />
        </IconActionButton>
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
            class="p-3 rounded-xl bg-muted/15 hover:bg-muted/30 transition-colors"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">
                  {{ formatPromptVersionDate(version.createdAt) }}
                </div>
                <div
                  v-if="version.note"
                  class="text-xs text-muted-foreground mt-0.5 truncate"
                  :title="version.note"
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
  </Transition>
</template>

<style scoped>
/* Scrim fades while the panel slides in from the right. */
.history-drawer-enter-active,
.history-drawer-leave-active {
  transition: opacity 200ms ease-out;
}

.history-drawer-enter-active .history-panel,
.history-drawer-leave-active .history-panel {
  transition: transform 200ms ease-out;
}

.history-drawer-enter-from,
.history-drawer-leave-to {
  opacity: 0;
}

.history-drawer-enter-from .history-panel,
.history-drawer-leave-to .history-panel {
  transform: translateX(24px);
}

@media (prefers-reduced-motion: reduce) {
  .history-drawer-enter-active,
  .history-drawer-leave-active,
  .history-drawer-enter-active .history-panel,
  .history-drawer-leave-active .history-panel {
    transition: none;
  }
}
</style>
