<script setup lang="ts">
import type { ModelDebugLogEntry } from '@/composables/useModelDebugLogs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

defineProps<{
  logs: ModelDebugLogEntry[]
  activeLogId: string
  detailOpen: boolean
  formatDate: (value: string) => string
  formatDuration: (value: number) => string
  openLogDetail: (item: ModelDebugLogEntry) => void
}>()
</script>

<template>
  <Card>
    <CardHeader class="pb-3">
      <CardTitle>日志列表（{{ logs.length }}）</CardTitle>
      <CardDescription>点击任意行可在右侧抽屉查看完整请求/响应详情</CardDescription>
    </CardHeader>
    <CardContent class="p-0">
      <div class="max-h-[72vh] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="whitespace-nowrap">
                时间
              </TableHead>
              <TableHead>
                Provider
              </TableHead>
              <TableHead>
                操作
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
              <TableCell
                class="max-w-[220px] truncate"
                :title="item.operation"
              >
                {{ item.operation }}
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
                :colspan="6"
                class="h-24 text-center text-muted-foreground"
              >
                暂无日志
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>
</template>
