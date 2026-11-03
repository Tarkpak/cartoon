<script setup lang="ts">
import { CircleAlert, CircleCheck, ListChecks, Loader2, RefreshCw, X } from 'lucide-vue-next'
import { useGlobalTasks } from '@/composables/useGlobalTasks'
import type { GlobalTask } from '@/lib/global-tasks'

const router = useRouter()
const open = ref(false)
const { tasks, loading, lastError, summary, refresh } = useGlobalTasks()

const buttonLabel = computed(() => {
  const parts = ['任务中心']
  if (summary.value.running) parts.push(`${summary.value.running} 个进行中`)
  if (summary.value.failed) parts.push(`${summary.value.failed} 个失败`)
  return parts.join(' · ')
})

const groups = computed(() => [
  { key: 'running', label: '进行中', items: tasks.value.filter(task => task.status === 'running') },
  { key: 'failed', label: '失败', items: tasks.value.filter(task => task.status === 'failed') },
  { key: 'done', label: '最近完成', items: tasks.value.filter(task => task.status === 'done').slice(0, 10) }
].filter(group => group.items.length > 0))

const timeFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function formatTime(value: string) {
  const time = Date.parse(value)
  return Number.isFinite(time) ? timeFormatter.format(time) : ''
}

function openTask(task: GlobalTask) {
  open.value = false
  void router.push(task.to)
}

watch(open, (isOpen) => {
  if (isOpen) void refresh()
})
</script>

<template>
  <div class="relative inline-flex">
    <IconActionButton
      :label="buttonLabel"
      :active="open"
      @click="open = true"
    >
      <ListChecks class="h-4 w-4" />
    </IconActionButton>
    <!-- Running count wins over failures; a failure-only state shows a red dot. -->
    <span
      v-if="summary.running"
      class="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-2xs font-semibold leading-none tabular-nums text-primary-foreground"
      aria-hidden="true"
    >
      {{ summary.running }}
    </span>
    <span
      v-else-if="summary.failed"
      class="pointer-events-none absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-background"
      aria-hidden="true"
    />

    <Dialog v-model:open="open">
      <SheetContent aria-describedby="">
        <div class="flex items-center justify-between gap-2 border-b p-4">
          <div class="min-w-0">
            <DialogTitle>任务中心</DialogTitle>
            <p class="mt-0.5 text-xs text-muted-foreground">
              视频/图片增强、字幕擦除与视频转项目的后台任务
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <IconActionButton
              label="刷新"
              :loading="loading"
              @click="refresh()"
            >
              <RefreshCw class="h-4 w-4" />
            </IconActionButton>
            <IconActionButton
              label="关闭"
              @click="open = false"
            >
              <X class="h-4 w-4" />
            </IconActionButton>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <p
            v-if="lastError"
            class="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {{ lastError }}
          </p>
          <EmptyState
            v-if="groups.length === 0 && !loading"
            :icon="ListChecks"
            title="暂无后台任务"
            description="在「工具」中发起的增强、字幕擦除和视频转项目任务会显示在这里。"
            compact
          />
          <section
            v-for="group in groups"
            :key="group.key"
            class="mb-4 last:mb-0"
          >
            <h3 class="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
              {{ group.label }} · {{ group.items.length }}
            </h3>
            <ul class="space-y-1">
              <li
                v-for="task in group.items"
                :key="task.key"
              >
                <button
                  type="button"
                  class="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  @click="openTask(task)"
                >
                  <Loader2
                    v-if="task.status === 'running'"
                    class="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary"
                    aria-hidden="true"
                  />
                  <CircleAlert
                    v-else-if="task.status === 'failed'"
                    class="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <CircleCheck
                    v-else
                    class="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="flex items-baseline justify-between gap-2">
                      <span class="truncate text-sm font-medium text-foreground">{{ task.title }}</span>
                      <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ formatTime(task.updatedAt) }}</span>
                    </span>
                    <span
                      class="mt-0.5 block truncate text-xs"
                      :class="task.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'"
                    >
                      {{ task.sourceLabel }}<template v-if="task.detail"> · {{ task.detail }}</template>
                    </span>
                    <Progress
                      v-if="task.status === 'running' && task.progress !== undefined"
                      :model-value="task.progress"
                      class="mt-1.5 h-1"
                      :aria-label="`${task.title} 进度 ${task.progress}%`"
                    />
                  </span>
                </button>
              </li>
            </ul>
          </section>
        </div>
      </SheetContent>
    </Dialog>
  </div>
</template>
