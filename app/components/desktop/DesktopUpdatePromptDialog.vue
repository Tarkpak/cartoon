<script setup lang="ts">
import {
  ChevronDown,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  TriangleAlert,
  X
} from 'lucide-vue-next'
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
import { isUpdateSnoozed, snoozeUpdate } from '@/lib/update-snooze'
import { clientArchLabel, clientChannelLabel, clientPlatformLabel } from '#shared/utils/display-labels'

const STARTUP_UPDATE_CHECK_DELAY_MS = 1200
const AUTOMATIC_UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000

const {
  updateInfo: clientUpdateInfo,
  checking: clientUpdateChecking,
  error: clientUpdateError,
  checkForClientUpdate,
  snoozeClientUpdate,
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

const promptVisible = ref(false)
const detailsOpen = ref(false)
const startupCheckStarted = useState<boolean>('desktop-updater-startup-check-started', () => false)
const lastAutomaticCheckAt = useState<number>('desktop-updater-last-automatic-check-at', () => 0)
let startupCheckTimer: number | null = null
let automaticCheckTimer: number | null = null

const DESKTOP_UPDATE_SNOOZE_KEY = 'playlet:desktop-update-snooze'

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
const showForceUpdateDialog = computed(() => promptVisible.value && isForceUpdate.value)
const showUpdateNotice = computed(() => promptVisible.value && !isForceUpdate.value)
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
const primaryActionLabel = computed(() => {
  if (activeClientUpdate.value) return '下载更新'
  if (installing.value) return '正在更新...'
  if (desktopError.value) return '重试更新'
  return '更新并重启'
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
    detailsOpen.value = false
    promptVisible.value = true
    return
  }

  const update = await checkDesktopUpdate()
  if (!update || isUpdateSnoozed(window.localStorage, DESKTOP_UPDATE_SNOOZE_KEY, update.version)) return

  detailsOpen.value = false
  promptVisible.value = true
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

function snoozeUpdatePrompt() {
  if (activeClientUpdate.value) {
    snoozeClientUpdate()
    promptVisible.value = false
    return
  }

  if (availableUpdate.value) {
    snoozeUpdate(window.localStorage, DESKTOP_UPDATE_SNOOZE_KEY, availableUpdate.value.version)
  }
  promptVisible.value = false
}

function handleOpenChange(nextOpen: boolean) {
  if (nextOpen) {
    promptVisible.value = true
    return
  }

  if (installing.value || blocksDismiss.value) return
  snoozeUpdatePrompt()
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
    v-if="isDesktopRuntime && isForceUpdate && activeClientUpdate"
    :open="showForceUpdateDialog"
    @update:open="handleOpenChange"
  >
    <DialogContent class="max-h-[90vh] overflow-hidden sm:max-w-xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <TriangleAlert class="h-5 w-5 text-amber-500" />
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
            class="rounded-xl bg-muted/25 px-2 py-1 font-medium text-foreground"
          >
            {{ versionBadgeLabel }}
          </span>
          <span
            v-if="activeClientUpdate"
            class="rounded-xl bg-muted/25 px-2 py-1"
          >
            {{ clientPlatformLabel(activeClientUpdate.platform) }} / {{ clientArchLabel(activeClientUpdate.arch) }} / {{ clientChannelLabel(activeClientUpdate.channel) }}
          </span>
          <span v-if="formattedUpdateDate">
            发布时间：{{ formattedUpdateDate }}
          </span>
        </div>

        <div
          v-if="activeUpdateBody"
          class="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/20 p-3 text-xs leading-6 text-muted-foreground"
        >
          {{ activeUpdateBody }}
        </div>
        <p
          v-else
          class="rounded-xl bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
        >
          这个版本没有提供更新说明。
        </p>

        <div
          v-if="isForceUpdate"
          class="flex items-start gap-2 rounded-xl border-0 bg-amber-500/8 p-3 text-sm text-amber-700 dark:text-amber-300"
        >
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <span>当前版本低于后台允许的最低版本，需要更新后继续使用。</span>
        </div>

        <div
          v-if="activeClientUpdate && !activeClientUpdate.downloadUrl"
          class="flex items-start gap-2 rounded-xl border-0 bg-amber-500/8 p-3 text-sm text-amber-700 dark:text-amber-300"
        >
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <span>后台没有配置下载地址，请联系管理员获取安装包。</span>
        </div>

        <div
          v-if="displayError"
          class="flex items-start gap-2 rounded-xl border-0 bg-destructive/8 p-3 text-sm text-destructive"
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
        <Button v-if="!blocksDismiss" variant="outline" @click="snoozeUpdatePrompt">
          24 小时后提醒
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

  <Teleport to="body">
    <div
      v-if="isDesktopRuntime"
      class="pointer-events-none fixed inset-x-4 bottom-4 z-[90] flex justify-end sm:inset-x-6 sm:bottom-6"
    >
      <Transition
        enter-active-class="transition-[transform,opacity] duration-200 ease-out"
        enter-from-class="translate-y-2 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition-[transform,opacity] duration-150 ease-out"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="translate-y-1 opacity-0"
      >
        <section
          v-if="showUpdateNotice && (activeClientUpdate || availableUpdate)"
          role="status"
          aria-live="polite"
          class="pointer-events-auto w-[22rem] max-w-full overflow-hidden rounded-xl bg-popover shadow-[0_16px_48px_hsl(var(--foreground)/0.14)] text-popover-foreground shadow-[0_18px_50px_hsl(var(--foreground)/0.16)]"
        >
          <div class="flex items-start gap-3 p-4">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Loader2 v-if="installing" class="h-4 w-4 animate-spin" />
              <TriangleAlert v-else-if="desktopError" class="h-4 w-4 text-destructive" />
              <Rocket v-else class="h-4 w-4" />
            </div>

            <div class="min-w-0 flex-1">
              <h2 class="text-sm font-semibold leading-5">
                {{ desktopError ? '更新未完成' : updateTitle }}
              </h2>
              <p class="mt-0.5 text-xs leading-5 text-muted-foreground">
                {{ desktopError || updateDescription }}
              </p>
            </div>

            <button
              type="button"
              class="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="24 小时后提醒更新"
              title="24 小时后提醒"
              :disabled="installing"
              @click="snoozeUpdatePrompt"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <div v-if="installing" class="space-y-2 px-4 pb-4">
            <div class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{{ statusMessage || '正在下载更新...' }}</span>
              <span class="shrink-0 tabular-nums">{{ downloadStatusLabel }}</span>
            </div>
            <Progress
              :model-value="downloadProgress ?? 35"
              :class="downloadProgress === null ? 'animate-pulse' : ''"
            />
          </div>

          <div
            v-if="detailsOpen"
            class="max-h-48 overflow-y-auto px-4 py-3"
          >
            <p class="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
              {{ activeUpdateBody || '这个版本没有提供更新说明。' }}
            </p>
            <p v-if="formattedUpdateDate" class="mt-2 text-[11px] text-muted-foreground">
              发布时间：{{ formattedUpdateDate }}
            </p>
          </div>

          <div class="flex items-center justify-between gap-2 px-3 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              class="h-8 gap-1 px-2 text-xs font-medium text-muted-foreground"
              :aria-expanded="detailsOpen"
              @click="detailsOpen = !detailsOpen"
            >
              更新内容
              <ChevronDown
                class="h-3.5 w-3.5 transition-transform duration-150"
                :class="detailsOpen ? 'rotate-180' : ''"
              />
            </Button>

            <Button
              size="sm"
              class="h-8 gap-1.5 px-3 text-xs active:scale-[0.96] transition-[background-color,border-color,color,box-shadow,transform]"
              :disabled="installing || isChecking || !canRunPrimaryAction"
              @click="handlePrimaryAction"
            >
              <Loader2 v-if="installing" class="h-3.5 w-3.5 animate-spin" />
              <ExternalLink v-else-if="activeClientUpdate" class="h-3.5 w-3.5" />
              <RefreshCw v-else-if="desktopError" class="h-3.5 w-3.5" />
              <Download v-else class="h-3.5 w-3.5" />
              {{ primaryActionLabel }}
            </Button>
          </div>
        </section>
      </Transition>
    </div>
  </Teleport>
</template>
