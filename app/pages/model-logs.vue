<script setup lang="ts">
import ModelLogsDetailDrawer from '@/components/model-logs/ModelLogsDetailDrawer.vue'
import ModelLogsFilters from '@/components/model-logs/ModelLogsFilters.vue'
import ModelLogsTable from '@/components/model-logs/ModelLogsTable.vue'

definePageMeta({ layout: 'default' })

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
  fetchLogs,
  clearLogs
} = useModelDebugLogs()
</script>

<template>
  <div class="min-h-screen space-y-6 bg-background p-6">
    <ModelLogsFilters
      v-model:auto-refresh="autoRefresh"
      v-model:keyword="filters.keyword"
      v-model:limit="filters.limit"
      v-model:model="filters.model"
      v-model:operation="filters.operation"
      v-model:provider="filters.provider"
      v-model:status="filters.status"
      :all-filter-value="allFilterValue"
      :clearing="clearing"
      :fetch-error="fetchError"
      :loading="loading"
      :operation-options="operationOptions"
      :provider-options="providerOptions"
      @clear="clearLogs"
      @refresh="fetchLogs"
    />

    <ModelLogsTable
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
    />
  </div>
</template>
