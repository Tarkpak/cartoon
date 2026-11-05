<script setup lang="ts">
import { Activity, ScrollText, ChartNoAxesColumn } from 'lucide-vue-next'
import type { SegmentedTabItem } from '@/components/ui/segmented-tabs/SegmentedTabs.vue'

type LogsTab = 'system' | 'model' | 'usage'

const props = defineProps<{
  activeTab: LogsTab
}>()

const emit = defineEmits<{
  select: [tab: LogsTab]
}>()

const tabs: Array<SegmentedTabItem<LogsTab>> = [
  { value: 'usage', label: '用量与费用', icon: ChartNoAxesColumn },
  { value: 'model', label: '大模型日志', icon: ScrollText },
  { value: 'system', label: '系统日志', icon: Activity }
]

const active = computed({
  get: () => props.activeTab,
  set: (tab: LogsTab) => emit('select', tab)
})
</script>

<template>
  <SegmentedTabs
    v-model="active"
    :items="tabs"
    aria-label="日志类型"
  />
</template>
