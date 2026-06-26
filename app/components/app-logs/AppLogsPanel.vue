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
import AppLogsDetailDrawer from '@/components/app-logs/AppLogsDetailDrawer.vue'
import { useAppLogs, type AppLogEntry } from '@/composables/useAppLogs'

const props = defineProps<{
  initialRequestId?: string
}>()

const detailOpen = ref(false)

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

if (props.initialRequestId) {
  filters.requestId = props.initialRequestId
}

watch(() => props.initialRequestId, (value) => {
  filters.requestId = value || ''
  void fetchLogs()
})

function normalizeSelectValue(value: string) {
  return value === allFilterValue ? '' : value
}

function levelVariant(level: AppLogEntry['level']) {
  if (level === 'error') return 'destructive'
  if (level === 'warn') return 'warning'
  if (level === 'debug') return 'outline'
  return 'secondary'
}

function openLogDetail(item: AppLogEntry) {
  activeLogId.value = item.id
  detailOpen.value = true
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
    <Card class="shrink-0 shadow-none">
      <CardContent class="space-y-4 p-4">
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

    <Card class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent class="min-h-0 flex-1 p-0">
        <Table container-class="h-full">
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
              :class="item.id === activeLogId && detailOpen ? 'bg-muted/60' : ''"
              @click="openLogDetail(item)"
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
      </CardContent>
    </Card>

    <AppLogsDetailDrawer
      v-model:open="detailOpen"
      :active-log="activeLog"
      :format-date="formatDate"
      :format-duration="formatDuration"
      :to-pretty-json="toPrettyJson"
    />
  </div>
</template>
