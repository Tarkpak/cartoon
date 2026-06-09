<script setup lang="ts">
import { Loader2, RefreshCw, Trash2 } from 'lucide-vue-next'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppLogs, type AppLogEntry } from '@/composables/useAppLogs'

definePageMeta({ layout: 'default' })

const {
  logs,
  activeLogId,
  activeLog,
  loading,
  clearing,
  fetchError,
  autoRefresh,
  filters,
  levelOptions,
  sourceOptions,
  allFilterValue,
  formatDate,
  formatDuration,
  toPrettyJson,
  fetchLogs,
  clearLogs
} = useAppLogs()

function normalizeSelectValue(value: string) {
  return value === allFilterValue ? '' : value
}

function levelVariant(level: AppLogEntry['level']) {
  if (level === 'error') return 'destructive'
  if (level === 'warn') return 'warning'
  if (level === 'debug') return 'outline'
  return 'secondary'
}
</script>

<template>
  <div class="min-h-screen space-y-6 bg-background p-6">
    <Card>
      <CardHeader>
        <CardTitle>系统日志</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-7">
          <Select
            :model-value="filters.level || allFilterValue"
            @update:model-value="(value) => filters.level = normalizeSelectValue(String(value))"
          >
            <SelectTrigger class="h-9">
              <SelectValue placeholder="全部级别" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="allFilterValue">
                全部级别
              </SelectItem>
              <SelectItem
                v-for="item in levelOptions"
                :key="item"
                :value="item"
              >
                {{ item }}
              </SelectItem>
            </SelectContent>
          </Select>

          <Select
            :model-value="filters.source || allFilterValue"
            @update:model-value="(value) => filters.source = normalizeSelectValue(String(value))"
          >
            <SelectTrigger class="h-9">
              <SelectValue placeholder="全部来源" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="allFilterValue">
                全部来源
              </SelectItem>
              <SelectItem
                v-for="item in sourceOptions"
                :key="item"
                :value="item"
              >
                {{ item }}
              </SelectItem>
            </SelectContent>
          </Select>

          <Input
            v-model="filters.category"
            placeholder="类别"
          />
          <Input
            v-model="filters.path"
            placeholder="路径"
          />
          <Input
            v-model="filters.requestId"
            placeholder="Request ID"
          />
          <Input
            v-model="filters.keyword"
            placeholder="关键词"
          />
          <Input
            v-model.number="filters.limit"
            type="number"
            min="1"
            max="500"
          />
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <Button
            :disabled="loading"
            @click="fetchLogs"
          >
            <Loader2
              v-if="loading"
              class="mr-2 h-4 w-4 animate-spin"
            />
            <RefreshCw
              v-else
              class="mr-2 h-4 w-4"
            />
            刷新
          </Button>

          <Button
            variant="outline"
            :disabled="clearing"
            @click="clearLogs"
          >
            <Loader2
              v-if="clearing"
              class="mr-2 h-4 w-4 animate-spin"
            />
            <Trash2
              v-else
              class="mr-2 h-4 w-4"
            />
            清空日志
          </Button>

          <label class="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox v-model:checked="autoRefresh" />
            自动刷新（5秒）
          </label>
        </div>

        <p
          v-if="fetchError"
          class="text-sm text-destructive"
        >
          {{ fetchError }}
        </p>
      </CardContent>
    </Card>

    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader class="pb-3">
          <CardTitle>日志列表（{{ logs.length }}）</CardTitle>
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
                    级别
                  </TableHead>
                  <TableHead>
                    来源
                  </TableHead>
                  <TableHead>
                    类别
                  </TableHead>
                  <TableHead>
                    路径
                  </TableHead>
                  <TableHead class="whitespace-nowrap">
                    状态
                  </TableHead>
                  <TableHead>
                    Request ID
                  </TableHead>
                  <TableHead>
                    信息
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody v-if="logs.length > 0">
                <TableRow
                  v-for="item in logs"
                  :key="item.id"
                  class="cursor-pointer"
                  :class="item.id === activeLogId ? 'bg-muted/60' : ''"
                  @click="activeLogId = item.id"
                >
                  <TableCell class="whitespace-nowrap text-xs text-muted-foreground">
                    {{ formatDate(item.timestamp) }}
                  </TableCell>
                  <TableCell>
                    <Badge :variant="levelVariant(item.level)">
                      {{ item.level }}
                    </Badge>
                  </TableCell>
                  <TableCell class="whitespace-nowrap">
                    {{ item.source }}
                  </TableCell>
                  <TableCell class="whitespace-nowrap">
                    {{ item.category }}
                  </TableCell>
                  <TableCell
                    class="max-w-[220px] truncate"
                    :title="item.path"
                  >
                    {{ item.path || '-' }}
                  </TableCell>
                  <TableCell class="whitespace-nowrap">
                    {{ item.status || '-' }}
                  </TableCell>
                  <TableCell
                    class="max-w-[220px] truncate font-mono text-xs"
                    :title="item.requestId"
                  >
                    {{ item.requestId || '-' }}
                  </TableCell>
                  <TableCell
                    class="max-w-[320px] truncate"
                    :title="item.message"
                  >
                    {{ item.message }}
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
          </div>
        </CardContent>
      </Card>

      <Card class="h-fit">
        <CardHeader>
          <CardTitle>详情</CardTitle>
        </CardHeader>
        <CardContent v-if="activeLog" class="space-y-3 text-sm">
          <div class="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2">
            <span class="text-muted-foreground">时间</span>
            <span>{{ formatDate(activeLog.timestamp) }}</span>
            <span class="text-muted-foreground">级别</span>
            <span>{{ activeLog.level }}</span>
            <span class="text-muted-foreground">来源</span>
            <span>{{ activeLog.source }}</span>
            <span class="text-muted-foreground">类别</span>
            <span class="break-all">{{ activeLog.category }}</span>
            <span class="text-muted-foreground">方法</span>
            <span>{{ activeLog.method || '-' }}</span>
            <span class="text-muted-foreground">路径</span>
            <span class="break-all">{{ activeLog.path || '-' }}</span>
            <span class="text-muted-foreground">状态</span>
            <span>{{ activeLog.status || '-' }}</span>
            <span class="text-muted-foreground">耗时</span>
            <span>{{ formatDuration(activeLog.durationMs) }}</span>
            <span class="text-muted-foreground">Request ID</span>
            <span class="break-all font-mono text-xs">{{ activeLog.requestId || '-' }}</span>
          </div>

          <div>
            <p class="text-xs text-muted-foreground">
              信息
            </p>
            <p class="mt-1 whitespace-pre-wrap break-words">
              {{ activeLog.message }}
            </p>
          </div>

          <div v-if="activeLog.metadata">
            <p class="text-xs text-muted-foreground">
              Metadata
            </p>
            <pre class="mt-1 max-h-64 overflow-auto rounded border bg-muted/40 p-3 text-xs">{{ toPrettyJson(activeLog.metadata) }}</pre>
          </div>

          <div v-if="activeLog.error">
            <p class="text-xs text-muted-foreground">
              Error
            </p>
            <pre class="mt-1 max-h-64 overflow-auto rounded border bg-muted/40 p-3 text-xs">{{ toPrettyJson(activeLog.error) }}</pre>
          </div>
        </CardContent>
        <CardContent v-else class="text-sm text-muted-foreground">
          选择一条日志
        </CardContent>
      </Card>
    </div>
  </div>
</template>
