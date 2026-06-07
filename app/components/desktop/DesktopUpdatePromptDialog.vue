<script setup lang="ts">
import { Download, Loader2, Sparkles, TriangleAlert } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { useDesktopUpdater } from '@/composables/useDesktopUpdater'

const STARTUP_UPDATE_CHECK_DELAY_MS = 1200

const {
  availableUpdate,
  checking,
  installing,
  downloadedBytes,
  totalBytes,
  error,
  statusMessage,
  isDesktopRuntime,
  downloadProgress,
  checkDesktopUpdate,
  installDesktopUpdate
} = useDesktopUpdater()

const dialogOpen = ref(false)
const startupCheckStarted = useState<boolean>('desktop-updater-startup-check-started', () => false)
const dismissedVersion = useState<string>('desktop-updater-dismissed-version', () => '')
let startupCheckTimer: number | null = null

const formattedUpdateDate = computed(() => {
  if (!availableUpdate.value?.date) return ''
  const date = new Date(availableUpdate.value.date)
  if (Number.isNaN(date.getTime())) return availableUpdate.value.date
  return date.toLocaleString()
})

function formatBytes(value: number): string {
  if (value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

const downloadStatusLabel = computed(() => {
  if (!installing.value) return ''
  if (totalBytes.value) {
    return `${formatBytes(downloadedBytes.value)} / ${formatBytes(totalBytes.value)}`
  }
  if (downloadedBytes.value > 0) return formatBytes(downloadedBytes.value)
  return '准备下载'
})

async function runStartupUpdateCheck() {
  if (!isDesktopRuntime.value || checking.value || installing.value) return

  const update = await checkDesktopUpdate()
  if (!update || dismissedVersion.value === update.version) return

  dialogOpen.value = true
}

function dismissUpdatePrompt() {
  if (availableUpdate.value) {
    dismissedVersion.value = availableUpdate.value.version
  }
  dialogOpen.value = false
}

function handleOpenChange(nextOpen: boolean) {
  if (nextOpen) {
    dialogOpen.value = true
    return
  }

  if (installing.value) return
  dismissUpdatePrompt()
}

onMounted(() => {
  if (!isDesktopRuntime.value || startupCheckStarted.value) return

  startupCheckStarted.value = true
  startupCheckTimer = window.setTimeout(() => {
    void runStartupUpdateCheck()
  }, STARTUP_UPDATE_CHECK_DELAY_MS)
})

onBeforeUnmount(() => {
  if (!startupCheckTimer) return
  window.clearTimeout(startupCheckTimer)
  startupCheckTimer = null
})
</script>

<template>
  <Dialog
    v-if="isDesktopRuntime && availableUpdate"
    :open="dialogOpen"
    @update:open="handleOpenChange"
  >
    <DialogContent class="max-h-[90vh] overflow-hidden sm:max-w-xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Sparkles class="h-5 w-5 text-primary" />
          发现新版本 {{ availableUpdate.version }}
        </DialogTitle>
        <DialogDescription>
          当前版本 {{ availableUpdate.currentVersion }}，可更新到 {{ availableUpdate.version }}。
        </DialogDescription>
      </DialogHeader>

      <div class="min-h-0 space-y-4">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span class="rounded-md border bg-muted/30 px-2 py-1 font-medium text-foreground">
            {{ availableUpdate.currentVersion }} -> {{ availableUpdate.version }}
          </span>
          <span v-if="formattedUpdateDate">
            发布时间：{{ formattedUpdateDate }}
          </span>
        </div>

        <div
          v-if="availableUpdate.body"
          class="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-xs leading-6 text-muted-foreground"
        >
          {{ availableUpdate.body }}
        </div>
        <p
          v-else
          class="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
        >
          这个版本没有提供更新说明。
        </p>

        <div
          v-if="error"
          class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ error }}</span>
        </div>

        <div
          v-if="installing"
          class="space-y-2"
        >
          <div class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{{ statusMessage || '正在安装更新...' }}</span>
            <span class="shrink-0">{{ downloadStatusLabel }}</span>
          </div>
          <Progress
            :model-value="downloadProgress ?? 35"
            :class="downloadProgress === null ? 'animate-pulse' : ''"
          />
        </div>
      </div>

      <DialogFooter class="gap-2 sm:justify-end">
        <Button
          variant="outline"
          :disabled="installing"
          @click="dismissUpdatePrompt"
        >
          稍后
        </Button>
        <Button
          :disabled="installing || checking"
          @click="installDesktopUpdate"
        >
          <Loader2
            v-if="installing"
            class="h-4 w-4 animate-spin"
          />
          <Download
            v-else
            class="h-4 w-4"
          />
          {{ installing ? '安装中...' : '下载并安装' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
