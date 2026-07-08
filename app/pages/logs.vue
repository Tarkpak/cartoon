<script setup lang="ts">
import AppLogsPanel from '@/components/app-logs/AppLogsPanel.vue'
import LogsTabSwitcher from '@/components/logs/LogsTabSwitcher.vue'
import ModelLogsPanel from '@/components/model-logs/ModelLogsPanel.vue'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

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
  <AppPage>
    <AppPageHeader
      title="日志"
      description="查看系统运行日志和大模型调用记录"
    >
      <template #actions>
      <LogsTabSwitcher
        :active-tab="activeTab"
        @select="selectTab"
      />
      </template>
    </AppPageHeader>

    <AppPageContent inner-class="flex h-full min-h-0 flex-col">
      <AppLogsPanel
        v-if="activeTab === 'system'"
        :initial-request-id="requestIdFilter"
      />
      <ModelLogsPanel
        v-else
        :initial-request-id="requestIdFilter"
      />
    </AppPageContent>
  </AppPage>
</template>
