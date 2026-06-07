<script setup lang="ts">
import { CheckCircle2, Download, Loader2, RefreshCw, RotateCw, TriangleAlert } from 'lucide-vue-next'
import { useDesktopUpdater } from '@/composables/useDesktopUpdater'

const {
  currentVersion,
  availableUpdate,
  checking,
  installing,
  downloadedBytes,
  totalBytes,
  error,
  statusMessage,
  lastCheckedAt,
  isDesktopRuntime,
  hasUpdate,
  downloadProgress,
  loadDesktopAppVersion,
  checkDesktopUpdate,
  installDesktopUpdate
} = useDesktopUpdater()

const formattedLastCheckedAt = computed(() => {
  if (!lastCheckedAt.value) return '尚未检查'
  const date = new Date(lastCheckedAt.value)
  if (Number.isNaN(date.getTime())) return lastCheckedAt.value
  return date.toLocaleString()
})

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

onMounted(() => {
  void loadDesktopAppVersion()
})
</script>

<template>
  <div
    v-if="isDesktopRuntime"
    class="space-y-4 rounded-lg border bg-background p-5"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="text-sm font-medium">
          应用更新
        </h3>
        <p class="mt-1 text-xs text-muted-foreground">
          管理当前桌面客户端版本并检查 GitHub Release 更新。
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        class="h-8 gap-1.5"
        :disabled="checking || installing"
        @click="checkDesktopUpdate"
      >
        <Loader2
          v-if="checking"
          class="h-3.5 w-3.5 animate-spin"
        />
        <RefreshCw
          v-else
          class="h-3.5 w-3.5"
        />
        {{ checking ? '检查中...' : '检查更新' }}
      </Button>
    </div>

    <div class="grid grid-cols-1 gap-3 text-sm @sm:grid-cols-2">
      <div class="rounded-md border bg-muted/20 p-3">
        <div class="text-xs text-muted-foreground">
          当前版本
        </div>
        <div class="mt-1 font-medium">
          {{ currentVersion || '未知' }}
        </div>
      </div>
      <div class="rounded-md border bg-muted/20 p-3">
        <div class="text-xs text-muted-foreground">
          上次检查
        </div>
        <div class="mt-1 font-medium">
          {{ formattedLastCheckedAt }}
        </div>
      </div>
    </div>

    <div
      v-if="error"
      class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
      {{ error }}
    </div>

    <div
      v-else-if="statusMessage && !hasUpdate"
      class="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400"
    >
      <CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0" />
      {{ statusMessage }}
    </div>

    <div
      v-if="hasUpdate && availableUpdate"
      class="space-y-3 rounded-lg border bg-muted/20 p-4"
    >
      <div class="flex flex-col gap-3 @xl:flex-row @xl:items-start @xl:justify-between">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="text-sm font-semibold">
              发现新版本 {{ availableUpdate.version }}
            </h4>
            <span class="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {{ availableUpdate.currentVersion }} -> {{ availableUpdate.version }}
            </span>
          </div>
          <p
            v-if="formattedUpdateDate"
            class="mt-1 text-xs text-muted-foreground"
          >
            发布时间：{{ formattedUpdateDate }}
          </p>
        </div>

        <Button
          size="sm"
          class="shrink-0 gap-2"
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
      </div>

      <div
        v-if="availableUpdate.body"
        class="whitespace-pre-wrap rounded-md border bg-background p-3 text-xs leading-6 text-muted-foreground"
      >
        {{ availableUpdate.body }}
      </div>

      <div
        v-if="installing"
        class="space-y-2"
      >
        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <span>{{ statusMessage || '正在安装更新...' }}</span>
          <span>{{ downloadStatusLabel }}</span>
        </div>
        <div class="h-2 overflow-hidden rounded-full bg-muted">
          <div
            class="h-full bg-primary transition-all"
            :class="downloadProgress === null ? 'w-1/3 animate-pulse' : ''"
            :style="downloadProgress === null ? undefined : { width: `${downloadProgress}%` }"
          />
        </div>
      </div>
    </div>

    <p class="flex items-start gap-2 text-xs text-muted-foreground">
      <RotateCw class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>安装完成后应用会自动重启；更新源来自当前 Tauri 配置中的 release endpoint。</span>
    </p>
  </div>
</template>
