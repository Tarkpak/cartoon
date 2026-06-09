<script setup lang="ts">
import { Download, Loader2, RefreshCw } from 'lucide-vue-next'
import { useDesktopFfmpeg } from '@/composables/useDesktopFfmpeg'

const {
  status: desktopFfmpegStatus,
  checking: desktopFfmpegChecking,
  installing: desktopFfmpegInstalling,
  error: desktopFfmpegError,
  isDesktopRuntime,
  canAutoInstall: canAutoInstallDesktopFfmpeg,
  statusLabel: desktopFfmpegStatusLabel,
  statusDescription: desktopFfmpegStatusDescription,
  ensureDesktopFfmpegStatus,
  refreshDesktopFfmpegStatus,
  installDesktopFfmpeg
} = useDesktopFfmpeg()

onMounted(() => {
  void ensureDesktopFfmpegStatus()
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
          桌面视频依赖（FFmpeg）
        </h3>
        <p class="mt-1 text-xs text-muted-foreground">
          本地视频拼接、导出等媒体处理依赖 FFmpeg。桌面端会自动检测，缺失时可在这里一键安装。
        </p>
      </div>
      <span
        class="rounded-full px-2 py-1 text-xs font-medium"
        :class="desktopFfmpegStatus?.available
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'"
      >
        {{ desktopFfmpegStatusLabel }}
      </span>
    </div>

    <p class="text-xs text-muted-foreground">
      {{ desktopFfmpegStatusDescription }}
    </p>

    <div
      v-if="desktopFfmpegStatus?.version || desktopFfmpegStatus?.path || desktopFfmpegStatus?.managedPath"
      class="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs"
    >
      <div v-if="desktopFfmpegStatus?.version">
        <span class="text-muted-foreground">版本：</span>
        <span class="text-foreground">{{ desktopFfmpegStatus.version }}</span>
      </div>
      <div v-if="desktopFfmpegStatus?.path">
        <span class="text-muted-foreground">当前路径：</span>
        <span class="break-all font-mono text-foreground">{{ desktopFfmpegStatus.path }}</span>
      </div>
      <div v-if="desktopFfmpegStatus?.managedPath">
        <span class="text-muted-foreground">托管安装目录：</span>
        <span class="break-all font-mono text-foreground">{{ desktopFfmpegStatus.managedPath }}</span>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        class="h-8 gap-1.5"
        :disabled="desktopFfmpegChecking || desktopFfmpegInstalling"
        @click="refreshDesktopFfmpegStatus({ promptOnMissing: false })"
      >
        <RefreshCw
          class="h-3.5 w-3.5"
          :class="desktopFfmpegChecking ? 'animate-spin' : ''"
        />
        {{ desktopFfmpegChecking ? '检测中...' : '重新检测' }}
      </Button>

      <Button
        v-if="!desktopFfmpegStatus?.available && canAutoInstallDesktopFfmpeg"
        size="sm"
        class="h-8 gap-1.5"
        :disabled="desktopFfmpegInstalling || desktopFfmpegChecking"
        @click="installDesktopFfmpeg"
      >
        <Loader2
          v-if="desktopFfmpegInstalling"
          class="h-3.5 w-3.5 animate-spin"
        />
        <Download
          v-else
          class="h-3.5 w-3.5"
        />
        {{ desktopFfmpegInstalling ? '安装中...' : '一键安装 FFmpeg' }}
      </Button>
    </div>

    <p
      v-if="desktopFfmpegError"
      class="text-xs text-destructive"
    >
      {{ desktopFfmpegError }}
    </p>
  </div>
</template>
