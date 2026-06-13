<script setup lang="ts">
import type { Component } from 'vue'
import { Activity, ScrollText } from 'lucide-vue-next'

type LogsTab = 'system' | 'model'

defineProps<{
  activeTab: LogsTab
}>()

const emit = defineEmits<{
  select: [tab: LogsTab]
}>()

const tabs: Array<{
  value: LogsTab
  label: string
  icon: Component
}> = [
  { value: 'model', label: '大模型日志', icon: ScrollText },
  { value: 'system', label: '系统日志', icon: Activity }
]
</script>

<template>
  <div
    role="tablist"
    aria-label="日志类型"
    class="inline-flex w-fit shrink-0 rounded-md border bg-muted/40 p-1"
  >
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      :aria-selected="activeTab === tab.value"
      class="inline-flex h-9 items-center gap-2 rounded px-3 text-sm font-medium transition-colors"
      :class="activeTab === tab.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
      @click="emit('select', tab.value)"
    >
      <component
        :is="tab.icon"
        class="h-4 w-4"
      />
      {{ tab.label }}
    </button>
  </div>
</template>
