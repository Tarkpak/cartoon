<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import ModelLogsDetailDrawer from '@/components/model-logs/ModelLogsDetailDrawer.vue'
import ModelLogsFilters from '@/components/model-logs/ModelLogsFilters.vue'
import ModelLogsTable from '@/components/model-logs/ModelLogsTable.vue'

const props = defineProps<{
  initialRequestId?: string
}>()

const {
  logs,
  activeLogId,
  activeLog,
  detailOpen,
  loading,
  clearing,
  fetchError,
  autoRefresh,
  total,
  page,
  totalPages,
  pageStart,
  pageEnd,
  filters,
  providerOptions,
  operationOptions,
  allFilterValue,
  openLogDetail,
  formatDate,
  formatDuration,
  toPrettyJson,
  toReadableText,
  fetchLogs,
  previousPage,
  nextPage,
  clearLogs
} = useModelDebugLogs()

if (props.initialRequestId) {
  filters.requestId = props.initialRequestId
}

watch(() => props.initialRequestId, (value) => {
  filters.requestId = value || ''
  void fetchLogs()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
    <ModelLogsFilters
      class="shrink-0"
      v-model:auto-refresh="autoRefresh"
      v-model:keyword="filters.keyword"
      v-model:limit="filters.limit"
      v-model:model="filters.model"
      v-model:operation="filters.operation"
      v-model:provider="filters.provider"
      v-model:project-id="filters.projectId"
      v-model:request-id="filters.requestId"
      v-model:scene-id="filters.sceneId"
      v-model:status="filters.status"
      v-model:task-id="filters.taskId"
      :all-filter-value="allFilterValue"
      :clearing="clearing"
      :fetch-error="fetchError"
      :loading="loading"
      :operation-options="operationOptions"
      :provider-options="providerOptions"
      @clear="clearLogs"
      @refresh="fetchLogs"
    >
      <template #tabs>
        <slot name="tabs" />
      </template>
    </ModelLogsFilters>

    <ModelLogsTable
      class="min-h-0 flex-1"
      :active-log-id="activeLogId"
      :detail-open="detailOpen"
      :format-date="formatDate"
      :format-duration="formatDuration"
      :logs="logs"
      :open-log-detail="openLogDetail"
    />

    <Card class="shrink-0 shadow-none">
      <CardContent class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="text-sm text-muted-foreground">
          第 {{ page }} / {{ totalPages }} 页，显示 {{ pageStart }}-{{ pageEnd }} 条，共 {{ total }} 条
        </div>
        <div class="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="loading || page <= 1"
            @click="previousPage"
          >
            <ChevronLeft class="mr-1 h-4 w-4" />
            上一页
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="loading || page >= totalPages"
            @click="nextPage"
          >
            下一页
            <ChevronRight class="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <ModelLogsDetailDrawer
      v-model:open="detailOpen"
      :active-log="activeLog"
      :format-date="formatDate"
      :format-duration="formatDuration"
      :to-pretty-json="toPrettyJson"
      :to-readable-text="toReadableText"
    />
  </div>
</template>
