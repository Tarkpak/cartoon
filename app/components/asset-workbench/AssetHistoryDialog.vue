<script setup lang="ts">
import { Check, Eye, Loader2 } from 'lucide-vue-next'
import type { AssetImageHistoryEntry } from '~/lib/asset-workbench-types'
import { toImageSrc } from '~/lib/media'

const props = defineProps<{
  open: boolean
  title: string
  targetLabel: string
  currentImage?: string
  entries: AssetImageHistoryEntry[]
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'preview': [payload: { src: string | undefined, alt: string }]
  'select': [entry: AssetImageHistoryEntry]
}>()

function isCurrent(entry: AssetImageHistoryEntry): boolean {
  return (props.currentImage || '').trim() === (entry.image || '').trim()
}

function resolveSourceLabel(entry: AssetImageHistoryEntry): string {
  if (entry.source === 'uploaded') return '上传'
  if (entry.source === 'generated') return '生成'
  return '现有'
}

function formatEntryTime(entry: AssetImageHistoryEntry): string {
  if (!entry.createdAt) return '时间未知'

  const parsed = new Date(entry.createdAt)
  if (Number.isNaN(parsed.getTime())) return '时间未知'

  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-h-[85vh] overflow-hidden sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          目标：{{ targetLabel || '-' }}，从历史版本中挑选一个作为当前资产。
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="entries.length === 0"
        class="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground"
      >
        暂无历史记录
      </div>

      <div
        v-else
        class="grid max-h-[64vh] grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3"
      >
        <div
          v-for="entry in entries"
          :key="entry.id"
          class="overflow-hidden rounded-lg border bg-card"
        >
          <button
            type="button"
            class="block aspect-square w-full overflow-hidden bg-muted/30"
            @click="emit('preview', { src: entry.image, alt: `${targetLabel} 历史资产` })"
          >
            <img
              :src="toImageSrc(entry.image)"
              :alt="`${targetLabel} 历史资产`"
              class="h-full w-full object-cover"
            >
          </button>

          <div class="space-y-2 px-3 py-2.5">
            <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span class="rounded-full border px-2 py-0.5">{{ resolveSourceLabel(entry) }}</span>
              <span>{{ formatEntryTime(entry) }}</span>
              <span
                v-if="isCurrent(entry)"
                class="rounded-full bg-primary/10 px-2 py-0.5 text-primary"
              >
                当前
              </span>
            </div>

            <p
              v-if="entry.prompt"
              class="line-clamp-2 text-xs text-muted-foreground"
            >
              {{ entry.prompt }}
            </p>

            <div class="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                class="h-8 flex-1"
                @click="emit('preview', { src: entry.image, alt: `${targetLabel} 历史资产` })"
              >
                <Eye class="mr-1 h-3.5 w-3.5" />
                预览
              </Button>
              <Button
                size="sm"
                class="h-8 flex-1"
                :disabled="loading || isCurrent(entry)"
                @click="emit('select', entry)"
              >
                <Loader2
                  v-if="loading"
                  class="mr-1 h-3.5 w-3.5 animate-spin"
                />
                <Check
                  v-else
                  class="mr-1 h-3.5 w-3.5"
                />
                {{ isCurrent(entry) ? '当前使用中' : '设为当前' }}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
