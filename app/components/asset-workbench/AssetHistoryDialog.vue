<script setup lang="ts">
import { Check, Eye, Loader2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { AssetImageHistoryEntry } from '~/lib/asset-workbench-types'
import { toImageSrc } from '~/lib/media'

const props = defineProps<{
  open: boolean
  title: string
  targetType?: 'character' | 'environment' | 'prop' | null
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

function resolveEntryById(entryId: string): AssetImageHistoryEntry | null {
  return props.entries.find(entry => entry.id === entryId) || null
}

function resolveSourceLabel(entry: AssetImageHistoryEntry): string {
  if (entry.source === 'uploaded') return '上传'
  if (entry.source === 'cropped') return '取景'
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

const denseModeThreshold = 9
const ultraDenseModeThreshold = 16
const selectedEntryId = ref('')

const isEnvironmentHistory = computed(() => props.targetType === 'environment')
const isCharacterHistory = computed(() => props.targetType === 'character')
const isSplitPreviewLayout = computed(() => isEnvironmentHistory.value || isCharacterHistory.value)

function resolveDefaultEntryId(): string {
  const currentEntry = props.entries.find(entry => isCurrent(entry))
  if (currentEntry) return currentEntry.id
  return props.entries[0]?.id || ''
}

const selectedEntry = computed(() => {
  if (props.entries.length === 0) return null
  return resolveEntryById(selectedEntryId.value) || props.entries[0] || null
})

function selectPreviewEntry(entry: AssetImageHistoryEntry) {
  selectedEntryId.value = entry.id
}

function resolvePreviewClass(total: number): string {
  if (total > ultraDenseModeThreshold) return 'asset-history-preview--ultra'
  if (total > denseModeThreshold) return 'asset-history-preview--dense'
  return 'asset-history-preview--normal'
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    selectedEntryId.value = resolveDefaultEntryId()
  }
)

watch(
  () => props.entries,
  (entries) => {
    if (entries.length === 0) {
      selectedEntryId.value = ''
      return
    }

    if (!entries.some(entry => entry.id === selectedEntryId.value)) {
      selectedEntryId.value = resolveDefaultEntryId()
    }
  },
  { deep: false }
)
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-h-[90vh] overflow-hidden sm:max-w-6xl">
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
        v-else-if="isSplitPreviewLayout"
        class="grid min-h-0 grid-cols-1 gap-3 lg:h-[72vh] lg:grid-cols-[260px_minmax(0,1fr)]"
      >
        <div class="min-h-0 overflow-y-auto rounded-lg border bg-card lg:h-full">
          <Button
            v-for="(entry, index) in entries"
            :key="entry.id"
            type="button"
            variant="ghost"
            class="h-auto w-full justify-start rounded-none border-b px-2.5 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40"
            :class="entry.id === selectedEntryId ? 'bg-muted/55' : ''"
            @click="selectPreviewEntry(entry)"
          >
            <div class="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-muted/30">
              <img
                :src="toImageSrc(entry.image)"
                :alt="`${targetLabel} 历史资产`"
                class="h-full w-full object-cover"
              >
              <span class="absolute left-1 top-1 rounded border bg-background/90 px-1 py-0.5 text-[10px] text-muted-foreground">
                #{{ entries.length - index }}
              </span>
            </div>

            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span class="rounded-full border px-1.5 py-0.5">{{ resolveSourceLabel(entry) }}</span>
                <span
                  v-if="isCurrent(entry)"
                  class="rounded-full bg-primary/10 px-1.5 py-0.5 text-primary"
                >
                  当前
                </span>
              </div>
              <p class="truncate text-[11px] text-muted-foreground">
                {{ formatEntryTime(entry) }}
              </p>
              <p
                v-if="entry.prompt"
                class="line-clamp-1 text-[11px] text-muted-foreground/85"
              >
                {{ entry.prompt }}
              </p>
            </div>
          </Button>
        </div>

        <div
          v-if="selectedEntry"
          class="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card lg:h-full"
        >
          <Button
            type="button"
            variant="ghost"
            :class="[
              'asset-history-preview',
              'asset-history-preview--selected p-0 hover:bg-transparent',
              isEnvironmentHistory ? 'asset-history-preview--environment' : '',
              isCharacterHistory ? 'asset-history-preview--character' : ''
            ]"
            @click="emit('preview', { src: selectedEntry.image, alt: `${targetLabel} 历史资产` })"
          >
            <img
              :src="toImageSrc(selectedEntry.image)"
              :alt="`${targetLabel} 历史资产`"
              class="block h-full w-full object-contain"
            >
          </Button>

          <div class="space-y-2 px-3 py-2.5">
            <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span class="rounded-full border px-2 py-0.5">{{ resolveSourceLabel(selectedEntry) }}</span>
              <span>{{ formatEntryTime(selectedEntry) }}</span>
              <span
                v-if="isCurrent(selectedEntry)"
                class="rounded-full bg-primary/10 px-2 py-0.5 text-primary"
              >
                当前
              </span>
            </div>

            <p
              v-if="selectedEntry.prompt"
              class="line-clamp-3 text-xs text-muted-foreground"
            >
              {{ selectedEntry.prompt }}
            </p>

            <div class="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                class="h-8 flex-1"
                @click="emit('preview', { src: selectedEntry.image, alt: `${targetLabel} 历史资产` })"
              >
                <Eye class="mr-1 h-3.5 w-3.5" />
                预览
              </Button>
              <Button
                size="sm"
                class="h-8 flex-1"
                :disabled="loading || isCurrent(selectedEntry)"
                @click="emit('select', selectedEntry)"
              >
                <Loader2
                  v-if="loading"
                  class="mr-1 h-3.5 w-3.5 animate-spin"
                />
                <Check
                  v-else
                  class="mr-1 h-3.5 w-3.5"
                />
                {{ isCurrent(selectedEntry) ? '当前使用中' : '设为当前' }}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div
        v-else
        :class="[
          'asset-history-grid',
          entries.length > denseModeThreshold ? 'asset-history-grid--dense' : ''
        ]"
      >
        <div
          v-for="entry in entries"
          :key="entry.id"
          class="flex flex-col overflow-hidden rounded-lg border bg-card"
        >
          <Button
            type="button"
            variant="ghost"
            :class="[
              'asset-history-preview',
              'h-auto w-full p-0 hover:bg-transparent',
              resolvePreviewClass(entries.length)
            ]"
            @click="emit('preview', { src: entry.image, alt: `${targetLabel} 历史资产` })"
          >
            <img
              :src="toImageSrc(entry.image)"
              :alt="`${targetLabel} 历史资产`"
              class="h-full w-full object-cover"
            >
          </Button>

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

<style scoped>
.asset-history-grid {
  display: grid;
  max-height: 68vh;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.asset-history-preview {
  display: block;
  width: 100%;
  flex-shrink: 0;
  overflow: hidden;
  background: hsl(var(--muted) / 0.3);
}

.asset-history-preview--selected {
  display: flex;
  flex: 1 1 auto;
  min-height: 320px;
  align-items: center;
  justify-content: center;
}

.asset-history-preview--normal {
  height: 240px;
  min-height: 240px;
}

.asset-history-preview--dense {
  height: 190px;
  min-height: 190px;
}

.asset-history-preview--ultra {
  height: 170px;
  min-height: 170px;
}

.asset-history-preview--environment {
  min-height: 320px;
  background: hsl(var(--muted) / 0.45);
}

.asset-history-preview--character {
  min-height: 340px;
  background: hsl(var(--muted) / 0.42);
}

.asset-history-preview--selected.asset-history-preview--environment,
.asset-history-preview--selected.asset-history-preview--character {
  min-height: 360px;
}

@media (max-width: 1023px) {
  .asset-history-preview--environment {
    min-height: 260px;
  }

  .asset-history-preview--character {
    min-height: 280px;
  }

  .asset-history-preview--selected {
    min-height: 280px;
  }

  .asset-history-preview--selected.asset-history-preview--environment,
  .asset-history-preview--selected.asset-history-preview--character {
    min-height: 300px;
  }
}

@media (min-width: 640px) {
  .asset-history-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1280px) {
  .asset-history-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .asset-history-grid--dense {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
