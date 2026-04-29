<script setup lang="ts">
import { Check, Loader2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
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

const selectedEntryId = ref<string>('')
const previewEntryId = ref<string>('')
const previewSwitching = ref(false)
let previewSwitchToken = 0

function resolveEntryById(entryId: string): AssetVideoHistoryEntry | null {
  return props.entries.find(entry => entry.id === entryId) || null
}

function isCurrent(entry: AssetVideoHistoryEntry): boolean {
  return (props.currentVideoUrl || '').trim() === (entry.videoUrl || '').trim()
}

function resolveDefaultEntryId(): string {
  const currentEntry = props.entries.find(entry => isCurrent(entry))
  if (currentEntry) return currentEntry.id
  return props.entries[0]?.id || ''
}

const previewEntry = computed(() => {
  if (props.entries.length === 0) return null
  return resolveEntryById(previewEntryId.value) || props.entries[0] || null
})

const pendingPreviewEntry = computed(() => {
  if (!previewSwitching.value) return null
  if (!selectedEntryId.value || selectedEntryId.value === previewEntryId.value) return null
  return resolveEntryById(selectedEntryId.value)
})

function resetSelectionToDefault() {
  const defaultId = resolveDefaultEntryId()
  selectedEntryId.value = defaultId
  previewEntryId.value = defaultId
  previewSwitching.value = false
  previewSwitchToken += 1
}

function preloadVideo(url: string): Promise<void> {
  if (!import.meta.client) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const probe = document.createElement('video')
    probe.preload = 'auto'
    probe.muted = true
    probe.playsInline = true

    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('video preload timeout'))
    }, 10000)

    const cleanup = () => {
      window.clearTimeout(timeout)
      probe.onloadeddata = null
      probe.oncanplay = null
      probe.onerror = null
      probe.removeAttribute('src')
      probe.load()
    }

    const onReady = () => {
      cleanup()
      resolve()
    }

    const onError = () => {
      cleanup()
      reject(new Error('video preload failed'))
    }

    probe.onloadeddata = onReady
    probe.oncanplay = onReady
    probe.onerror = onError
    probe.src = url
    probe.load()
  })
}

async function handleSelectEntry(entry: AssetVideoHistoryEntry) {
  selectedEntryId.value = entry.id
  if (previewEntryId.value === entry.id) return

  const switchToken = ++previewSwitchToken
  previewSwitching.value = true

  try {
    await preloadVideo(entry.videoUrl)
  } catch {
    // 即使预加载失败，仍尝试切换，避免用户无法预览
  }

  if (switchToken !== previewSwitchToken) return

  previewEntryId.value = entry.id
  previewSwitching.value = false
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    resetSelectionToDefault()
  }
)

watch(
  () => props.entries,
  (entries) => {
    if (entries.length === 0) {
      selectedEntryId.value = ''
      previewEntryId.value = ''
      previewSwitching.value = false
      previewSwitchToken += 1
      return
    }

    if (!entries.some(entry => entry.id === selectedEntryId.value)) {
      selectedEntryId.value = resolveDefaultEntryId()
    }

    if (!entries.some(entry => entry.id === previewEntryId.value)) {
      previewEntryId.value = selectedEntryId.value || resolveDefaultEntryId()
      previewSwitching.value = false
      previewSwitchToken += 1
    }
  },
  { deep: false }
)

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
        <DialogTitle>分镜视频历史</DialogTitle>
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
        class="grid max-h-[68vh] min-h-0 grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)]"
      >
        <div
          class="min-h-0 overflow-y-auto rounded-lg border bg-card"
        >
          <Button
            v-for="(entry, index) in entries"
            :key="entry.id"
            type="button"
            variant="ghost"
            class="h-auto w-full justify-start rounded-none border-b px-2.5 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40"
            :class="entry.id === selectedEntryId ? 'bg-muted/50' : ''"
            @click="handleSelectEntry(entry)"
          >
            <span class="mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              #{{ entries.length - index }}
            </span>
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span class="rounded-full border px-1.5 py-0.5">{{ resolveSourceLabel(entry) }}</span>
                <span
                  v-if="isCurrent(entry)"
                  class="rounded-full bg-primary/10 px-1.5 py-0.5 text-primary"
                >
                  当前
                </span>
                <span
                  v-if="entry.id === previewEntryId"
                  class="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600"
                >
                  预览中
                </span>
              </div>
              <p class="truncate text-xs text-muted-foreground">
                {{ formatEntryTime(entry) }}
              </p>
              <p
                v-if="entry.prompt"
                class="truncate text-[11px] text-muted-foreground/80"
              >
                {{ entry.prompt }}
              </p>
            </div>
          </Button>
        </div>

        <div
          v-if="previewEntry"
          class="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card"
        >
          <div class="relative min-h-[260px] flex-1 overflow-hidden bg-black">
            <video
              :src="previewEntry.videoUrl"
              class="h-full w-full object-contain"
              controls
              preload="auto"
              playsinline
            />
            <div
              v-if="previewSwitching && pendingPreviewEntry"
              class="absolute inset-0 flex items-center justify-center bg-black/45"
            >
              <div class="inline-flex items-center gap-2 rounded-md bg-background/95 px-3 py-1.5 text-xs text-foreground shadow">
                <Loader2 class="h-3.5 w-3.5 animate-spin" />
                <span class="truncate max-w-[220px]">切换预览中</span>
              </div>
            </div>
          </div>

          <div class="space-y-2 px-3 py-2.5">
            <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span class="rounded-full border px-2 py-0.5">{{ resolveSourceLabel(previewEntry) }}</span>
              <span>{{ formatEntryTime(previewEntry) }}</span>
              <span
                v-if="isCurrent(previewEntry)"
                class="rounded-full bg-primary/10 px-2 py-0.5 text-primary"
              >
                当前
              </span>
            </div>

            <p
              v-if="previewEntry.prompt"
              class="line-clamp-3 text-xs text-muted-foreground"
            >
              {{ previewEntry.prompt }}
            </p>

            <Button
              size="sm"
              class="h-8 w-full"
              :disabled="loading || previewSwitching || isCurrent(previewEntry)"
              @click="emit('select', previewEntry)"
            >
              <Loader2
                v-if="loading || previewSwitching"
                class="mr-1 h-3.5 w-3.5 animate-spin"
              />
              <Check
                v-else
                class="mr-1 h-3.5 w-3.5"
              />
              {{ isCurrent(previewEntry) ? '当前使用中' : '设为当前' }}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
