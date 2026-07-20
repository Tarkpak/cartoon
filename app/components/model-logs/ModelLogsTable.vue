<script setup lang="ts">
import type { ModelDebugLogEntry } from '@/composables/useModelDebugLogs'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

defineProps<{
  class?: string
  logs: ModelDebugLogEntry[]
  activeLogId: string
  detailOpen: boolean
  formatDate: (value: string) => string
  formatDuration: (value: number) => string
  openLogDetail: (item: ModelDebugLogEntry) => void
}>()
</script>

<template>
  <Card :class="cn('flex flex-col overflow-hidden shadow-none', $props.class)">
    <CardContent class="min-h-0 flex-1 p-0">
      <Table container-class="h-full">
        <TableHeader>
          <TableRow>
            <TableHead class="whitespace-nowrap">
              时间
            </TableHead>
            <TableHead>
              Provider
            </TableHead>
            <TableHead class="whitespace-nowrap">
              成员
            </TableHead>
            <TableHead>
              操作
            </TableHead>
            <TableHead class="whitespace-nowrap">
              关联
            </TableHead>
            <TableHead>
              模型
            </TableHead>
            <TableHead>
              状态
            </TableHead>
            <TableHead class="whitespace-nowrap">
              耗时
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody v-if="logs.length > 0">
          <TableRow
            v-for="item in logs"
            :key="item.id"
            class="cursor-pointer"
            :class="item.id === activeLogId && detailOpen ? 'bg-muted/60' : ''"
            @click="openLogDetail(item)"
          >
            <TableCell class="whitespace-nowrap text-xs text-muted-foreground">
              {{ formatDate(item.timestamp) }}
            </TableCell>
            <TableCell class="font-medium">
              {{ item.provider }}
            </TableCell>
            <TableCell class="whitespace-nowrap text-sm">
              {{ item.ownerDisplayName || item.ownerAccount || '-' }}
            </TableCell>
            <TableCell
              class="max-w-[220px] truncate"
              :title="item.operation"
            >
              {{ item.operation }}
            </TableCell>
            <TableCell class="min-w-[180px] max-w-[260px] text-xs">
              <div
                v-if="item.taskId || item.sceneId || item.projectId"
                class="space-y-1 font-mono text-muted-foreground"
              >
                <p
                  v-if="item.taskId"
                  class="truncate"
                  :title="item.taskId"
                >
                  task {{ item.taskId }}
                </p>
                <p
                  v-if="item.sceneId"
                  class="truncate"
                  :title="item.sceneId"
                >
                  scene {{ item.sceneId }}
                </p>
                <p
                  v-if="item.projectId"
                  class="truncate"
                  :title="item.projectId"
                >
                  project {{ item.projectId }}
                </p>
              </div>
              <span
                v-else
                class="text-muted-foreground"
              >
                -
              </span>
            </TableCell>
            <TableCell
              class="max-w-[280px] truncate"
              :title="item.model"
            >
              {{ item.model || '-' }}
            </TableCell>
            <TableCell>
              <Badge :variant="item.status === 'success' ? 'default' : 'destructive'">
                {{ item.status }}
              </Badge>
            </TableCell>
            <TableCell class="whitespace-nowrap">
              {{ formatDuration(item.durationMs) }}
            </TableCell>
          </TableRow>
        </TableBody>

        <TableBody v-else>
          <TableRow>
            <TableCell
              :colspan="8"
              class="h-24 text-center text-muted-foreground"
            >
              暂无日志
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </CardContent>
  </Card>
</template>
