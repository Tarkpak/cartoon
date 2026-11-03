<script setup lang="ts">
import type { VideoImportArtifact, VideoImportStepRun } from '@/composables/useVideoImport'
import {
  friendlyVideoImportError,
  videoImportArtifactLabel,
  videoImportRunStatusLabel,
  videoImportRunStatusVariant,
  videoImportStepLabel
} from '~/lib/video-import-workflow'

defineProps<{
  stepRuns: VideoImportStepRun[]
  artifacts: VideoImportArtifact[]
}>()

function formatDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatDuration(value?: number | null) {
  if (value === null || value === undefined) return '进行中'
  if (value < 1000) return `${value} ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return ''
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

async function openPath(path: string) {
  const target = path.trim()
  if (!target) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_local_path', { path: target })
  } catch (error) {
    console.error('Failed to open artifact path:', error)
    window.alert('当前环境无法直接打开该文件。')
  }
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-2">
    <section class="rounded-xl border">
      <h2 class="border-b px-3 py-2 text-sm font-medium">执行记录</h2>
      <div v-if="stepRuns.length" class="max-h-[32rem] divide-y overflow-y-auto">
        <div
          v-for="run in stepRuns"
          :key="run.id"
          class="grid gap-2 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ videoImportStepLabel(run.step) }}</span>
              <Badge :variant="videoImportRunStatusVariant(run.status)" class="text-xs">
                {{ videoImportRunStatusLabel(run.status) }}
              </Badge>
              <span v-if="run.attempt > 1" class="text-xs text-muted-foreground">第 {{ run.attempt }} 次</span>
            </div>
            <div class="mt-0.5 text-xs text-muted-foreground">
              {{ formatDate(run.startedAt) }}
              <template v-if="run.provider"> · {{ run.provider }}</template>
              <template v-if="run.externalTaskId"> · 外部任务 {{ run.externalTaskId }}</template>
            </div>
            <div v-if="run.errorMessage" class="mt-1.5 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {{ friendlyVideoImportError(run.errorMessage) }}
            </div>
          </div>
          <div class="text-xs text-muted-foreground sm:text-right">{{ formatDuration(run.durationMs) }}</div>
        </div>
      </div>
      <div v-else class="px-3 py-8 text-center text-sm text-muted-foreground">暂无执行记录</div>
    </section>

    <section class="rounded-xl border">
      <h2 class="border-b px-3 py-2 text-sm font-medium">产物文件</h2>
      <div v-if="artifacts.length" class="max-h-[32rem] divide-y overflow-y-auto">
        <div
          v-for="artifact in artifacts"
          :key="artifact.id"
          class="flex items-start justify-between gap-2 px-3 py-2.5 text-sm"
        >
          <div class="min-w-0">
            <div class="font-medium">{{ videoImportArtifactLabel(artifact.kind) }}</div>
            <button
              type="button"
              class="mt-0.5 block max-w-full truncate text-left text-xs text-primary underline-offset-2 hover:underline"
              :title="artifact.path"
              @click="openPath(artifact.path)"
            >
              {{ artifact.path }}
            </button>
            <div class="mt-0.5 text-xs text-muted-foreground">{{ formatDate(artifact.createdAt) }}</div>
          </div>
          <span class="shrink-0 text-xs text-muted-foreground">{{ formatBytes(artifact.sizeBytes) }}</span>
        </div>
      </div>
      <div v-else class="px-3 py-8 text-center text-sm text-muted-foreground">暂无产物文件</div>
    </section>
  </div>
</template>
