<script setup lang="ts">
import { Activity, ScrollText } from 'lucide-vue-next'
import AppLogsPanel from '@/components/app-logs/AppLogsPanel.vue'
import ModelLogsPanel from '@/components/model-logs/ModelLogsPanel.vue'

definePageMeta({ layout: 'default' })

type LogsTab = 'system' | 'model'

const route = useRoute()
const router = useRouter()

const tabs: Array<{
  value: LogsTab
  label: string
  icon: unknown
}> = [
  { value: 'system', label: '系统日志', icon: Activity },
  { value: 'model', label: '模型调用', icon: ScrollText }
]

function getSingleQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined
  return typeof value === 'string' ? value : undefined
}

function normalizeTab(value: unknown): LogsTab {
  const raw = getSingleQueryValue(value)
  return raw === 'model' ? 'model' : 'system'
}

const activeTab = computed<LogsTab>(() => normalizeTab(route.query.tab))
const requestIdFilter = computed(() => getSingleQueryValue(route.query.requestId) || '')

function selectTab(tab: LogsTab) {
  if (activeTab.value === tab) return
  router.replace({
    path: '/logs',
    query: {
      ...route.query,
      tab
    }
  })
}
</script>

<template>
  <div class="min-h-screen space-y-6 bg-background p-6">
    <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-normal">
          日志
        </h1>
      </div>

      <div
        role="tablist"
        aria-label="日志类型"
        class="inline-flex w-fit rounded-md border bg-card p-1"
      >
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.value"
          class="inline-flex h-9 items-center gap-2 rounded px-3 text-sm font-medium transition-colors"
          :class="activeTab === tab.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
          @click="selectTab(tab.value)"
        >
          <component
            :is="tab.icon"
            class="h-4 w-4"
          />
          {{ tab.label }}
        </button>
      </div>
    </div>

    <AppLogsPanel
      v-if="activeTab === 'system'"
      :initial-request-id="requestIdFilter"
    />
    <ModelLogsPanel
      v-else
      :initial-request-id="requestIdFilter"
    />
  </div>
</template>
