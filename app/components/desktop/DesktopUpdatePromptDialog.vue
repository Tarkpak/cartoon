<script setup lang="ts">
import { Download, ExternalLink, Loader2, Sparkles, TriangleAlert } from 'lucide-vue-next'
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
import { useClientUpdateCheck } from '@/composables/useClientUpdateCheck'
import { useDesktopUpdater } from '@/composables/useDesktopUpdater'
import { clientArchLabel, clientChannelLabel, clientPlatformLabel } from '#shared/utils/display-labels'

const STARTUP_UPDATE_CHECK_DELAY_MS = 1200
const AUTOMATIC_UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000

const {
  updateInfo: clientUpdateInfo,
  checking: clientUpdateChecking,
  error: clientUpdateError,
  checkForClientUpdate,
  dismissClientUpdate,
  openClientUpdateDownload
} = useClientUpdateCheck()
const {
  availableUpdate,
  checking: desktopChecking,
  installing,
  downloadedBytes,
  totalBytes,
  error: desktopError,
  statusMessage,
  isDesktopRuntime,
  downloadProgress,
  checkDesktopUpdate,
  installDesktopUpdate
} = useDesktopUpdater()

const dialogOpen = ref(false)
const startupCheckStarted = useState<boolean>('desktop-updater-startup-check-started', () => false)
const dismissedVersion = useState<string>('desktop-updater-dismissed-version', () => '')
const lastAutomaticCheckAt = useState<number>('desktop-updater-last-automatic-check-at', () => 0)
let startupCheckTimer: number | null = null
let automaticCheckTimer: number | null = null

const activeClientUpdate = computed(() => {
  return clientUpdateInfo.value?.hasUpdate ? clientUpdateInfo.value : null
})
const activeUpdateBody = computed(() => {
  return activeClientUpdate.value?.releaseNotes || availableUpdate.value?.body || ''
})
const isChecking = computed(() => clientUpdateChecking.value || desktopChecking.value)
const displayError = computed(() => clientUpdateError.value || desktopError.value)
const isForceUpdate = computed(() => activeClientUpdate.value?.forceUpdate === true)
const blocksDismiss = computed(() => isForceUpdate.value && Boolean(activeClientUpdate.value?.downloadUrl))
const updateTitle = computed(() => {
  if (activeClientUpdate.value) {
    return `${isForceUpdate.value ? '需要更新客户端' : '发现新版本'} ${activeClientUpdate.value.latestVersion}`
  }
  return availableUpdate.value ? `发现新版本 ${availableUpdate.value.version}` : '发现新版本'
})
const updateDescription = computed(() => {
  if (activeClientUpdate.value) {
    return `当前版本 ${activeClientUpdate.value.currentVersion || '未知'}，可更新到 ${activeClientUpdate.value.latestVersion}。`
  }
  if (availableUpdate.value) {
    return `当前版本 ${availableUpdate.value.currentVersion}，可更新到 ${availableUpdate.value.version}。`
  }
  return ''
})
const versionBadgeLabel = computed(() => {
  if (activeClientUpdate.value) {
    return `${activeClientUpdate.value.currentVersion || '未知'} -> ${activeClientUpdate.value.latestVersion}`
  }
  if (availableUpdate.value) {
    return `${availableUpdate.value.currentVersion} -> ${availableUpdate.value.version}`
  }
  return ''
})
const canRunPrimaryAction = computed(() => {
  if (activeClientUpdate.value) return Boolean(activeClientUpdate.value.downloadUrl)
  return Boolean(availableUpdate.value)
})

const formattedUpdateDate = computed(() => {
  const value = activeClientUpdate.value?.publishedAt || availableUpdate.value?.date || ''
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
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

async function runAutomaticUpdateCheck() {
  if (!isDesktopRuntime.value || isChecking.value || installing.value) return

  lastAutomaticCheckAt.value = Date.now()
  const clientUpdate = await checkForClientUpdate()
  if (clientUpdate) {
    dialogOpen.value = true
    return
  }

  const update = await checkDesktopUpdate()
  if (!update || dismissedVersion.value === update.version) return

  dialogOpen.value = true
}

function runAutomaticUpdateCheckIfDue() {
  if (
    lastAutomaticCheckAt.value > 0
    && Date.now() - lastAutomaticCheckAt.value < AUTOMATIC_UPDATE_CHECK_INTERVAL_MS
  ) {
    return
  }

  void runAutomaticUpdateCheck()
}

function handleWindowFocus() {
  runAutomaticUpdateCheckIfDue()
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    runAutomaticUpdateCheckIfDue()
  }
}

function dismissUpdatePrompt() {
  if (activeClientUpdate.value) {
    dismissClientUpdate()
    dialogOpen.value = false
    return
  }

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

  if (installing.value || blocksDismiss.value) return
  dismissUpdatePrompt()
}

function handlePrimaryAction() {
  if (activeClientUpdate.value) {
    openClientUpdateDownload()
    return
  }
  void installDesktopUpdate()
}

onMounted(() => {
  if (!isDesktopRuntime.value || startupCheckStarted.value) return

  startupCheckStarted.value = true
  startupCheckTimer = window.setTimeout(() => {
    runAutomaticUpdateCheckIfDue()
  }, STARTUP_UPDATE_CHECK_DELAY_MS)
  automaticCheckTimer = window.setInterval(() => {
    runAutomaticUpdateCheckIfDue()
  }, AUTOMATIC_UPDATE_CHECK_INTERVAL_MS)
  window.addEventListener('focus', handleWindowFocus)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  if (startupCheckTimer) {
    window.clearTimeout(startupCheckTimer)
    startupCheckTimer = null
  }
  if (automaticCheckTimer) {
    window.clearInterval(automaticCheckTimer)
    automaticCheckTimer = null
  }
  window.removeEventListener('focus', handleWindowFocus)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  startupCheckStarted.value = false
})
</script>

<template>
  <Dialog
    v-if="isDesktopRuntime && (activeClientUpdate || availableUpdate)"
    :open="dialogOpen"
    @update:open="handleOpenChange"
  >
    <DialogContent class="max-h-[90vh] overflow-hidden sm:max-w-xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Sparkles class="h-5 w-5 text-primary" />
          {{ updateTitle }}
        </DialogTitle>
        <DialogDescription>
          {{ updateDescription }}
        </DialogDescription>
      </DialogHeader>

      <div class="min-h-0 space-y-4">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            v-if="versionBadgeLabel"
            class="rounded-md border bg-muted/30 px-2 py-1 font-medium text-foreground"
          >
            {{ versionBadgeLabel }}
          </span>
          <span
            v-if="activeClientUpdate"
            class="rounded-md border bg-muted/30 px-2 py-1"
          >
            {{ clientPlatformLabel(activeClientUpdate.platform) }} / {{ clientArchLabel(activeClientUpdate.arch) }} / {{ clientChannelLabel(activeClientUpdate.channel) }}
          </span>
          <span v-if="formattedUpdateDate">
            发布时间：{{ formattedUpdateDate }}
          </span>
        </div>

        <div
          v-if="activeUpdateBody"
          class="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-xs leading-6 text-muted-foreground"
        >
          {{ activeUpdateBody }}
        </div>
        <p
          v-else
          class="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
        >
          这个版本没有提供更新说明。
        </p>

        <div
          v-if="isForceUpdate"
          class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300"
        >
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <span>当前版本低于后台允许的最低版本，需要更新后继续使用。</span>
        </div>

        <div
          v-if="activeClientUpdate && !activeClientUpdate.downloadUrl"
          class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300"
        >
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <span>后台没有配置下载地址，请联系管理员获取安装包。</span>
        </div>

        <div
          v-if="displayError"
          class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <span>{{ displayError }}</span>
        </div>

        <div
          v-if="!activeClientUpdate && installing"
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
          v-if="!blocksDismiss"
          variant="outline"
          :disabled="installing"
          @click="dismissUpdatePrompt"
        >
          稍后
        </Button>
        <Button
          :disabled="installing || isChecking || !canRunPrimaryAction"
          @click="handlePrimaryAction"
        >
          <Loader2
            v-if="installing"
            class="h-4 w-4 animate-spin"
          />
          <ExternalLink
            v-else-if="activeClientUpdate"
            class="h-4 w-4"
          />
          <Download
            v-else
            class="h-4 w-4"
          />
          {{ activeClientUpdate ? '下载更新' : (installing ? '安装中...' : '下载并安装') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
