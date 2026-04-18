<script setup lang="ts">
import { Check, Loader2 } from 'lucide-vue-next'
import type { AssetVideoHistoryEntry } from '~/lib/asset-workbench-types'

const props = defineProps<{
  open: boolean
  targetLabel: string
  currentVideoUrl?: string
  entries: AssetVideoHistoryEntry[]
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'select': [entry: AssetVideoHistoryEntry]
}>()

function isCurrent(entry: AssetVideoHistoryEntry): boolean {
  return (props.currentVideoUrl || '').trim() === (entry.videoUrl || '').trim()
}

function resolveSourceLabel(entry: AssetVideoHistoryEntry): string {
  if (entry.source === 'generated') return '生成'
  if (entry.source === 'uploaded') return '上传'
  return '现有'
}

function formatEntryTime(entry: AssetVideoHistoryEntry): string {
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
        <DialogTitle>场景视频历史</DialogTitle>
        <DialogDescription>
          目标：{{ targetLabel || '-' }}，从历史生成结果中切换当前视频版本。
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
        class="grid max-h-[64vh] grid-cols-1 gap-3 overflow-y-auto pr-1 xl:grid-cols-2"
      >
        <div
          v-for="entry in entries"
          :key="entry.id"
          class="overflow-hidden rounded-lg border bg-card"
        >
          <div class="aspect-video overflow-hidden bg-black">
            <video
              :src="entry.videoUrl"
              class="h-full w-full"
              controls
              preload="metadata"
            />
          </div>

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

            <Button
              size="sm"
              class="h-8 w-full"
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
    </DialogContent>
  </Dialog>
</template>
