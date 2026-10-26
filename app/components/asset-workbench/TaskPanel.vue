<script setup lang="ts">
import { AlertCircle, Loader2, RotateCcw } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { WorkbenchTask } from '~/lib/asset-workbench-tasks'

const props = defineProps<{
  tasks: WorkbenchTask[]
  readOnly?: boolean
}>()

const emit = defineEmits<{
  open: [task: WorkbenchTask]
  'retry-failed-scenes': []
}>()

const runningCount = computed(() => props.tasks.filter(task => task.status === 'running').length)
const errorCount = computed(() => props.tasks.filter(task => task.status === 'error').length)
const retryableCount = computed(() => props.tasks.filter(task => task.retryable).length)
</script>

<template>
  <DropdownMenu v-if="tasks.length > 0">
    <DropdownMenuTrigger as-child>
      <Button
        variant="outline"
        size="sm"
        class="h-8 shrink-0 gap-1.5 px-2.5 text-xs tabular-nums"
        :aria-label="`生成任务：${runningCount} 个进行中，${errorCount} 个失败`"
      >
        <Loader2
          v-if="runningCount > 0"
          class="h-3.5 w-3.5 animate-spin text-primary"
        />
        <AlertCircle
          v-else
          class="h-3.5 w-3.5 text-destructive"
        />
        <span v-if="runningCount > 0">{{ runningCount }} 个任务</span>
        <span
          v-if="errorCount > 0"
          class="text-destructive"
        >
          {{ runningCount > 0 ? '· ' : '' }}{{ errorCount }} 失败
        </span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      class="w-80 p-0"
    >
      <DropdownMenuLabel class="flex items-center justify-between px-3 py-2 text-xs">
        <span>生成任务</span>
        <span class="font-normal text-muted-foreground tabular-nums">
          进行中 {{ runningCount }} · 失败 {{ errorCount }}
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator class="my-0" />
      <div class="max-h-80 overflow-y-auto p-1">
        <DropdownMenuItem
          v-for="task in tasks"
          :key="task.id"
          class="flex items-start gap-2 px-2 py-2"
          :title="task.detail"
          @select="emit('open', task)"
        >
          <Loader2
            v-if="task.status === 'running'"
            class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary"
          />
          <AlertCircle
            v-else
            class="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-medium text-foreground">{{ task.title }}</span>
            <span
              class="mt-0.5 line-clamp-2 text-xs"
              :class="task.status === 'error' ? 'text-destructive' : 'text-muted-foreground'"
            >
              {{ task.detail }}
            </span>
          </span>
        </DropdownMenuItem>
      </div>
      <template v-if="retryableCount > 0 && !readOnly">
        <DropdownMenuSeparator class="my-0" />
        <div class="p-1">
          <DropdownMenuItem
            class="gap-2 px-2 py-2 text-xs"
            @select="emit('retry-failed-scenes')"
          >
            <RotateCcw class="h-3.5 w-3.5 text-muted-foreground" />
            重试全部失败的分镜视频（{{ retryableCount }}）
          </DropdownMenuItem>
        </div>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
