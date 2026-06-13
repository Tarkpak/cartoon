<script setup lang="ts">
import AppLogsPanel from '@/components/app-logs/AppLogsPanel.vue'
import LogsTabSwitcher from '@/components/logs/LogsTabSwitcher.vue'
import ModelLogsPanel from '@/components/model-logs/ModelLogsPanel.vue'

definePageMeta({ layout: 'default' })

type LogsTab = 'system' | 'model'

const route = useRoute()
const router = useRouter()

function getSingleQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined
  return typeof value === 'string' ? value : undefined
}

function normalizeTab(value: unknown): LogsTab {
  const raw = getSingleQueryValue(value)
  return raw === 'system' ? 'system' : 'model'
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
  <div class="min-h-screen bg-background p-4 md:p-6">
    <AppLogsPanel
      v-if="activeTab === 'system'"
      :initial-request-id="requestIdFilter"
    >
      <template #tabs>
        <LogsTabSwitcher
          :active-tab="activeTab"
          @select="selectTab"
        />
      </template>
    </AppLogsPanel>
    <ModelLogsPanel
      v-else
      :initial-request-id="requestIdFilter"
    >
      <template #tabs>
        <LogsTabSwitcher
          :active-tab="activeTab"
          @select="selectTab"
        />
      </template>
    </ModelLogsPanel>
  </div>
</template>
