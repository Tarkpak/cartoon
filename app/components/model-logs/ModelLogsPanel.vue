<script setup lang="ts">
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
