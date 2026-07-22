<template>
  <AdminShell content-mode="fixed">
    <div class="page logs-page">
      <n-tabs v-model:value="activeTab" type="line" animated class="logs-tabs" @update:value="handleTabChange">
        <template #suffix>
          <div class="logs-toolbar">
          <span class="refresh-status">{{ lastUpdatedLabel }}</span>
          <span class="auto-refresh-control">自动刷新 <n-switch v-model:value="autoRefresh" size="small" /></span>
            <n-button size="small" :loading="activeLoading" @click="refreshActiveTab">刷新</n-button>
            <n-button size="small" :loading="exporting" :disabled="activeTab === 'archives'" @click="exportActiveResults">导出 CSV</n-button>
          </div>
        </template>
        <n-tab-pane name="calls" tab="调用日志">
          <div class="summary-strip">
            <div class="summary-metric"><span>调用量</span><strong>{{ summary.total }}</strong></div>
            <div class="summary-metric summary-metric--danger"><span>失败率</span><strong>{{ failureRate }}</strong></div>
            <div class="summary-metric"><span>平均耗时</span><strong><DurationIndicator :value="summary.averageDuration" /></strong></div>
            <div class="summary-metric"><span>积分消耗</span><strong>{{ summary.totalCredits }}</strong></div>
          </div>

          <section class="filter-panel" aria-label="调用日志筛选">
            <div class="filter-row">
              <n-input v-model:value="keyword" class="filter-search" placeholder="Request ID、错误、用户、项目或场景" clearable @keyup.enter="refreshLogsFromFirstPage" />
              <n-select v-model:value="filters.status" placeholder="状态" clearable :options="statusOptions" />
              <n-select v-model:value="filters.userId" placeholder="用户" clearable filterable :options="userOptions" />
              <n-select v-model:value="filters.provider" placeholder="供应商" clearable filterable :options="providerOptions" />
              <n-select v-model:value="filters.modelId" placeholder="模型" clearable filterable :options="modelOptions" />
              <n-select v-model:value="filters.operation" placeholder="操作" clearable :options="operationOptions" />
            </div>
            <div class="filter-row filter-row--secondary">
              <n-date-picker
                v-model:value="dateRange"
                type="datetimerange"
                clearable
                class="date-filter"
                start-placeholder="开始时间"
                end-placeholder="结束时间"
              />
              <n-input-number v-model:value="filters.minDuration" placeholder="最短耗时 ms" :min="0" clearable />
              <span class="range-separator">至</span>
              <n-input-number v-model:value="filters.maxDuration" placeholder="最长耗时 ms" :min="0" clearable />
              <n-select v-model:value="filters.sortBy" :options="sortOptions" class="sort-filter" />
              <n-button type="primary" @click="refreshLogsFromFirstPage">查询</n-button>
              <n-button :disabled="activeCallFilterCount === 0" @click="resetCallFilters">重置<span v-if="activeCallFilterCount">（{{ activeCallFilterCount }}）</span></n-button>
            </div>
          </section>

          <n-alert v-if="logsError" type="error" :bordered="false" class="state-alert">
            {{ logsError }} <n-button text type="primary" @click="loadLogs">重试</n-button>
          </n-alert>
          <n-data-table
            class="logs-data-table"
            :columns="columns"
            :data="logs"
            :loading="pending"
            :pagination="logsPagination"
            :row-props="rowProps"
            :scroll-x="1500"
            flex-height
            remote
            @update:page="handleLogsPageChange"
            @update:page-size="handleLogsPageSizeChange"
          >
            <template #empty><n-empty description="没有符合当前条件的调用日志" /></template>
          </n-data-table>
        </n-tab-pane>

        <n-tab-pane name="audit" tab="操作审计">
          <section class="filter-panel filter-panel--single" aria-label="操作审计筛选">
            <n-input v-model:value="auditKeyword" class="filter-search" placeholder="操作、目标或管理员" clearable @keyup.enter="refreshAuditFromFirstPage" />
            <n-date-picker
              v-model:value="auditDateRange"
              type="datetimerange"
              clearable
              class="date-filter"
              start-placeholder="开始时间"
              end-placeholder="结束时间"
            />
            <n-button type="primary" @click="refreshAuditFromFirstPage">查询</n-button>
            <n-button :disabled="!auditKeyword && !auditDateRange" @click="resetAuditFilters">重置</n-button>
          </section>
          <n-alert v-if="auditError" type="error" :bordered="false" class="state-alert">
            {{ auditError }} <n-button text type="primary" @click="loadAuditLogs">重试</n-button>
          </n-alert>
          <n-data-table
            class="logs-data-table"
            :columns="auditColumns"
            :data="auditLogs"
            :loading="auditLoading"
            :pagination="auditPagination"
            :scroll-x="1240"
            flex-height
            remote
            @update:page="handleAuditPageChange"
            @update:page-size="handleAuditPageSizeChange"
          >
            <template #empty><n-empty description="没有符合当前条件的操作记录" /></template>
          </n-data-table>
        </n-tab-pane>

        <n-tab-pane name="archives" tab="归档记录">
          <n-alert type="info" :bordered="false" class="archive-note">系统达到日志保留上限后自动归档旧记录。归档载荷不会在列表中直接展开。</n-alert>
          <n-alert v-if="archivesError" type="error" :bordered="false" class="state-alert">
            {{ archivesError }} <n-button text type="primary" @click="loadArchives">重试</n-button>
          </n-alert>
          <n-data-table
            class="logs-data-table"
            :columns="archiveColumns"
            :data="archives"
            :loading="archivesLoading"
            :pagination="archivesPagination"
            flex-height
            remote
            @update:page="handleArchivesPageChange"
            @update:page-size="handleArchivesPageSizeChange"
          >
            <template #empty><n-empty description="暂无归档记录" /></template>
          </n-data-table>
        </n-tab-pane>
      </n-tabs>

      <n-drawer v-model:show="drawer" :width="detailDrawerWidth">
        <n-drawer-content
          title="日志详情"
          closable
          :native-scrollbar="true"
        >
          <n-spin :show="detailLoading" class="detail-spin">
          <div v-if="selectedLog" class="log-detail">
            <div class="log-summary-grid">
              <div class="log-summary-item">
                <span class="log-summary-label">状态</span>
                <n-tag size="small" :type="statusTagType(selectedLog.status)">
                  {{ modelStatusLabel(selectedLog.status) }}
                </n-tag>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">时间</span>
                <span>{{ formatAdminDateTime(selectedLog.created_at) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">耗时</span>
                <DurationIndicator :value="selectedLog.duration_ms" />
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">用户</span>
                <span>{{ displayUser(selectedLog) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">供应商</span>
                <span>{{ providerLabel(selectedLog.provider) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">模型</span>
                <span>{{ displayValue(selectedLog.model_id) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">操作</span>
                <span>{{ modelOperationLabel(selectedLog.operation) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">费用</span>
                <span>{{ formatCost(selectedLog.estimated_cost) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">扣除积分</span>
                <span>{{ selectedLog.credits_charged ?? '-' }}</span>
              </div>
              <div class="log-summary-item log-summary-item--wide">
                <span class="log-summary-label">Request ID</span>
                <span class="log-mono">{{ displayValue(selectedLog.request_id) }}</span>
                <n-button
                  v-if="selectedLog.request_id"
                  size="tiny"
                  quaternary
                  @click="copyText(selectedLog.request_id, 'Request ID')"
                >
                  复制
                </n-button>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">项目</span>
                <span class="log-mono">{{ displayValue(selectedLog.project_id) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">场景</span>
                <span class="log-mono">{{ displayValue(selectedLog.scene_id) }}</span>
              </div>
            </div>

            <n-alert
              v-if="selectedLog.error_message"
              type="error"
              title="错误信息"
              :bordered="false"
            >
              <div class="log-error-message">{{ selectedLog.error_message }}</div>
            </n-alert>

            <n-tabs v-model:value="activeDetailTab" class="log-detail-tabs" type="line">
              <template #suffix>
                <div v-if="activeDetailTab !== 'raw'" class="log-detail-toolbar">
                  <span class="log-summary-label">{{ activePayloadViewLabel }}</span>
                  <n-radio-group v-model:value="activePayloadViewMode" size="small">
                    <n-radio-button value="text">格式化</n-radio-button>
                    <n-radio-button value="json">原始 JSON</n-radio-button>
                  </n-radio-group>
                </div>
              </template>

              <n-tab-pane name="request" tab="请求">
                <div class="log-detail-stack">
                  <section v-if="payloadViewModes.request === 'text'" class="log-payload-panel">
                    <div class="log-payload-body log-text-blocks">
                      <section
                        v-for="block in requestTextBlocks"
                        :key="block.title"
                        class="log-text-block"
                      >
                        <div class="log-block-header">
                          <div class="log-block-title">{{ block.title }}</div>
                          <n-button size="tiny" quaternary @click="copyText(block.content, block.title)">复制</n-button>
                        </div>
                        <pre>{{ block.content }}</pre>
                      </section>
                      <section v-if="requestMediaResources.length > 0" class="log-media-section">
                        <div class="log-block-title">媒体资源（{{ requestMediaResources.length }}）</div>
                        <div class="log-media-grid">
                          <article v-for="item in requestMediaResources" :key="item.id" class="log-media-card">
                            <div class="log-media-card-header">
                              <div>
                                <strong>{{ mediaKindLabel(item.kind) }}</strong>
                                <span>{{ item.path }}</span>
                              </div>
                              <a v-if="item.url" :href="item.url" target="_blank" rel="noopener noreferrer">打开资源</a>
                            </div>
                            <img v-if="item.url && item.kind === 'image'" :src="item.url" alt="请求图片资源" loading="lazy">
                            <video v-else-if="item.url && item.kind === 'video'" :src="item.url" controls preload="metadata" />
                            <audio v-else-if="item.url && item.kind === 'audio'" :src="item.url" controls preload="metadata" />
                            <div v-else class="log-media-unavailable">{{ item.note || '该媒体未保存可预览地址' }}</div>
                          </article>
                        </div>
                      </section>
                      <div v-if="requestTextBlocks.length === 0 && requestMediaResources.length === 0" class="log-empty">无可读请求内容</div>
                    </div>
                  </section>
                  <section v-else class="log-payload-panel">
                    <header class="log-payload-header">
                      <span>请求 JSON</span>
                      <n-button size="tiny" quaternary @click="copyText(jsonTextForPayload('request'), '请求 JSON')">复制</n-button>
                    </header>
                    <div class="log-payload-body">
                      <pre v-if="hasContent(jsonTextForPayload('request'))" class="json-view">{{ jsonTextForPayload('request') }}</pre>
                      <div v-else class="log-empty">无请求数据</div>
                    </div>
                  </section>
                </div>
              </n-tab-pane>

              <n-tab-pane name="response" tab="响应">
                <div class="log-detail-stack">
                  <section v-if="payloadViewModes.response === 'text'" class="log-payload-panel">
                    <div class="log-payload-body log-text-blocks">
                      <section
                        v-for="block in responseTextBlocks"
                        :key="block.title"
                        class="log-text-block"
                      >
                        <div class="log-block-header">
                          <div class="log-block-title">{{ block.title }}</div>
                          <n-button size="tiny" quaternary @click="copyText(block.content, block.title)">复制</n-button>
                        </div>
                        <pre>{{ block.content }}</pre>
                      </section>
                      <section v-if="responseMediaResources.length > 0" class="log-media-section">
                        <div class="log-block-title">媒体资源（{{ responseMediaResources.length }}）</div>
                        <div class="log-media-grid">
                          <article v-for="item in responseMediaResources" :key="item.id" class="log-media-card">
                            <div class="log-media-card-header">
                              <div>
                                <strong>{{ mediaKindLabel(item.kind) }}</strong>
                                <span>{{ item.path }}</span>
                              </div>
                              <a v-if="item.url" :href="item.url" target="_blank" rel="noopener noreferrer">打开资源</a>
                            </div>
                            <img v-if="item.url && item.kind === 'image'" :src="item.url" alt="响应图片资源" loading="lazy">
                            <video v-else-if="item.url && item.kind === 'video'" :src="item.url" controls preload="metadata" />
                            <audio v-else-if="item.url && item.kind === 'audio'" :src="item.url" controls preload="metadata" />
                            <div v-else class="log-media-unavailable">{{ item.note || '该媒体未保存可预览地址' }}</div>
                          </article>
                        </div>
                      </section>
                      <div v-if="responseTextBlocks.length === 0 && responseMediaResources.length === 0" class="log-empty">无可读响应内容</div>
                    </div>
                  </section>
                  <section v-else class="log-payload-panel">
                    <header class="log-payload-header">
                      <span>响应 JSON</span>
                      <n-button size="tiny" quaternary @click="copyText(jsonTextForPayload('response'), '响应 JSON')">复制</n-button>
                    </header>
                    <div class="log-payload-body">
                      <pre v-if="hasContent(jsonTextForPayload('response'))" class="json-view">{{ jsonTextForPayload('response') }}</pre>
                      <div v-else class="log-empty">无响应数据</div>
                    </div>
                  </section>
                </div>
              </n-tab-pane>

              <n-tab-pane v-if="hasLogError" name="error" tab="错误">
                <div class="log-detail-stack">
                  <section v-if="payloadViewModes.error === 'text'" class="log-payload-panel">
                    <header class="log-payload-header">错误摘要</header>
                    <div class="log-payload-body">
                      <pre v-if="selectedLog.error_message" class="log-error-block">{{ selectedLog.error_message }}</pre>
                      <div v-else class="log-empty">无错误摘要</div>
                    </div>
                  </section>
                  <section v-else class="log-payload-panel">
                    <header class="log-payload-header">
                      <span>错误 JSON</span>
                      <n-button size="tiny" quaternary @click="copyText(jsonTextForPayload('error'), '错误 JSON')">复制</n-button>
                    </header>
                    <div class="log-payload-body">
                      <pre v-if="hasContent(jsonTextForPayload('error'))" class="json-view">{{ jsonTextForPayload('error') }}</pre>
                      <div v-else class="log-empty">无错误数据</div>
                    </div>
                  </section>
                </div>
              </n-tab-pane>

              <n-tab-pane name="raw" tab="原始数据">
                <section class="log-payload-panel">
                  <header class="log-payload-header">
                    <span>完整日志</span>
                    <n-button size="tiny" quaternary @click="copyText(selectedLogJson, '完整日志')">复制</n-button>
                  </header>
                  <div class="log-payload-body">
                    <pre class="json-view json-view--tall">{{ selectedLogJson }}</pre>
                  </div>
                </section>
              </n-tab-pane>
            </n-tabs>
          </div>
          <n-empty v-else-if="!detailLoading" description="日志详情不可用" />
          </n-spin>
        </n-drawer-content>
      </n-drawer>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { h } from 'vue'
import {
  NButton,
  NDatePicker,
  NEllipsis,
  NRadioButton,
  NRadioGroup,
  NTag,
  useMessage
} from 'naive-ui'
import {
  auditActionLabel,
  auditTargetTypeLabel,
  modelOperationLabel,
  modelStatusLabel,
  providerLabel
} from '@playlet-shared/utils/display-labels'
import DurationIndicator from '~/components/logs/DurationIndicator.vue'

interface ModelCallLog {
  id: string
  user_id?: string
  account?: string
  display_name?: string
  request_id?: string
  provider?: string
  model_id?: string
  operation?: string
  project_id?: string
  scene_id?: string
  status?: string
  duration_ms?: number
  estimated_cost?: number
  credits_charged?: number
  error_message?: string
  created_at?: string
  request_json?: string
  response_json?: string
  error_json?: string
  request?: unknown
  response?: unknown
  media_refs?: unknown
  error?: unknown
  [key: string]: unknown
}

interface TextBlock {
  title: string
  content: string
}

type MediaKind = 'image' | 'audio' | 'video'

interface MediaResource {
  id: string
  kind: MediaKind
  path: string
  url?: string
  note?: string
}

interface AuditLog {
  id: string
  account?: string
  display_name?: string
  actor_user_id?: string
  action?: string
  target_type?: string
  target_id?: string
  metadata?: unknown
  ip?: string
  user_agent?: string
  created_at?: string
}

interface LogArchive {
  id: string
  archive_type?: string
  row_count?: number
  created_at?: string
}

interface LogSummary {
  total: number
  failed: number
  averageDuration: number
  totalCost: number
  totalCredits: number
}

interface SelectOption {
  value: string
  label?: string
}

interface LogOptions {
  users: SelectOption[]
  providers: SelectOption[]
  models: SelectOption[]
  operations: SelectOption[]
  statuses: SelectOption[]
}

type JsonPayloadKind = 'request' | 'response' | 'error'
type PayloadViewMode = 'text' | 'json'
type DetailTab = JsonPayloadKind | 'raw'

const message = useMessage()
const route = useRoute()
const router = useRouter()
const activeTab = ref<'calls' | 'audit' | 'archives'>('calls')
const autoRefresh = ref(false)
const lastUpdated = ref<Date | null>(null)
const exporting = ref(false)
const keyword = ref('')
const pending = ref(false)
const logsError = ref('')
const logs = ref<ModelCallLog[]>([])
const logsPage = ref(1)
const logsPageSize = ref(20)
const logsTotal = ref(0)
const summary = reactive<LogSummary>({ total: 0, failed: 0, averageDuration: 0, totalCost: 0, totalCredits: 0 })
const logOptions = reactive<LogOptions>({ users: [], providers: [], models: [], operations: [], statuses: [] })
const dateRange = ref<[number, number] | null>(null)
const filters = reactive({
  status: null as string | null,
  userId: null as string | null,
  provider: null as string | null,
  modelId: null as string | null,
  operation: null as string | null,
  minDuration: null as number | null,
  maxDuration: null as number | null,
  sortBy: 'createdAt:desc'
})
const auditKeyword = ref('')
const auditDateRange = ref<[number, number] | null>(null)
const auditLoading = ref(false)
const auditError = ref('')
const auditLogs = ref<AuditLog[]>([])
const auditPage = ref(1)
const auditPageSize = ref(20)
const auditTotal = ref(0)
const archivesLoading = ref(false)
const archivesError = ref('')
const archives = ref<LogArchive[]>([])
const archivesPage = ref(1)
const archivesPageSize = ref(20)
const archivesTotal = ref(0)
const drawer = ref(false)
const selectedLog = ref<ModelCallLog | null>(null)
const detailLoading = ref(false)
const activeDetailTab = ref<DetailTab>('request')
let detailRequestSequence = 0
let refreshTimer: ReturnType<typeof setInterval> | null = null
const payloadViewModes = reactive<Record<JsonPayloadKind, PayloadViewMode>>({
  request: 'text',
  response: 'text',
  error: 'text'
})
const detailDrawerWidth = 'min(1080px, 92vw)'

const activePayloadViewLabel = computed(() => ({
  request: '请求展示',
  response: '响应展示',
  error: '错误展示',
  raw: ''
}[activeDetailTab.value]))
const activePayloadViewMode = computed<PayloadViewMode>({
  get: () => activeDetailTab.value === 'raw' ? 'text' : payloadViewModes[activeDetailTab.value],
  set: value => {
    if (activeDetailTab.value !== 'raw') payloadViewModes[activeDetailTab.value] = value
  }
})

const selectedLogJson = computed(() => selectedLog.value ? stringifyJson(selectedLog.value) : '')
const requestTextBlocks = computed(() => selectedLog.value ? readableBlocksFor(selectedLog.value.request, 'request') : [])
const responseTextBlocks = computed(() => selectedLog.value ? readableBlocksFor(selectedLog.value.response, 'response') : [])
const requestMediaResources = computed(() => mediaResourcesFor('request', selectedLog.value?.request))
const responseMediaResources = computed(() => mediaResourcesFor('response', selectedLog.value?.response))
const hasLogError = computed(() => Boolean(selectedLog.value && (
  selectedLog.value.error_message
  || hasContent(selectedLog.value.error)
  || ['failed', 'error'].includes(selectedLog.value.status || '')
)))
const failureRate = computed(() => summary.total ? `${((summary.failed / summary.total) * 100).toFixed(1)}%` : '0%')
const lastUpdatedLabel = computed(() => lastUpdated.value
  ? `更新于 ${lastUpdated.value.toLocaleTimeString('zh-CN', { hour12: false })}`
  : '尚未更新')
const activeLoading = computed(() => activeTab.value === 'calls'
  ? pending.value
  : activeTab.value === 'audit' ? auditLoading.value : archivesLoading.value)
const activeCallFilterCount = computed(() => [
  keyword.value,
  filters.status,
  filters.userId,
  filters.provider,
  filters.modelId,
  filters.operation,
  filters.minDuration,
  filters.maxDuration,
  dateRange.value
].filter(value => value !== null && value !== '').length)

const statusOptions = computed(() => logOptions.statuses.map(option => ({ ...option, label: modelStatusLabel(option.value) })))
const userOptions = computed(() => logOptions.users.map(option => ({ ...option, label: option.label || option.value })))
const providerOptions = computed(() => logOptions.providers.map(option => ({ ...option, label: providerLabel(option.value) })))
const modelOptions = computed(() => logOptions.models.map(option => ({ ...option, label: option.value })))
const operationOptions = computed(() => logOptions.operations.map(option => ({ ...option, label: modelOperationLabel(option.value) })))
const sortOptions = [
  { label: '时间：最新优先', value: 'createdAt:desc' },
  { label: '时间：最早优先', value: 'createdAt:asc' },
  { label: '耗时：从高到低', value: 'duration:desc' },
  { label: '耗时：从低到高', value: 'duration:asc' },
  { label: '费用：从高到低', value: 'cost:desc' },
  { label: '积分：从高到低', value: 'credits:desc' }
]

const columns = [
  {
    title: '时间',
    key: 'created_at',
    width: 176,
    render(row: ModelCallLog) {
      return formatAdminDateTime(row.created_at)
    }
  },
  {
    title: '用户', key: 'account', width: 120,
    render: (row: ModelCallLog) => h(NEllipsis, { tooltip: true }, { default: () => displayUser(row) })
  },
  {
    title: '供应商',
    key: 'provider',
    width: 124,
    render(row: ModelCallLog) {
      return providerLabel(row.provider)
    }
  },
  {
    title: '模型', key: 'model_id', width: 180,
    render: (row: ModelCallLog) => h(NEllipsis, { tooltip: true }, { default: () => displayValue(row.model_id) })
  },
  {
    title: '操作',
    key: 'operation',
    width: 112,
    render(row: ModelCallLog) {
      return modelOperationLabel(row.operation)
    }
  },
  {
    title: '状态',
    key: 'status',
    width: 80,
    render(row: ModelCallLog) {
      return h(NTag, { size: 'small', type: statusTagType(row.status) }, { default: () => modelStatusLabel(row.status) })
    }
  },
  { title: '耗时', key: 'duration_ms', width: 88, render: (row: ModelCallLog) => h(DurationIndicator, { value: row.duration_ms }) },
  { title: '费用', key: 'estimated_cost', width: 72, render: (row: ModelCallLog) => formatCost(row.estimated_cost) },
  {
    title: '积分',
    key: 'credits_charged',
    width: 64,
    render(row: ModelCallLog) {
      return row.credits_charged ?? '-'
    }
  },
  {
    title: 'Request ID', key: 'request_id', width: 216,
    render(row: ModelCallLog) {
      if (!row.request_id) return '-'
      return h(NButton, {
        text: true,
        class: 'request-id-button',
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          void copyText(row.request_id || '', 'Request ID')
        }
      }, {
        default: () => h('span', {
          class: 'request-id-text',
          title: row.request_id
        }, row.request_id)
      })
    }
  },
  {
    title: '错误摘要', key: 'error_message', width: 236,
    render: (row: ModelCallLog) => row.error_message
      ? h(NEllipsis, { tooltip: true }, { default: () => row.error_message })
      : '-'
  }
]

const auditColumns = [
  { title: '时间', key: 'created_at', width: 180, render: (row: AuditLog) => formatAdminDateTime(row.created_at) },
  { title: '管理员', key: 'account', width: 140, render: (row: AuditLog) => row.display_name || row.account || row.actor_user_id || '-' },
  { title: '操作', key: 'action', width: 180, render: (row: AuditLog) => auditActionLabel(row.action) },
  { title: '目标类型', key: 'target_type', width: 130, render: (row: AuditLog) => auditTargetTypeLabel(row.target_type) },
  { title: '目标', key: 'target_id', width: 180, render: (row: AuditLog) => h(NEllipsis, { tooltip: true }, { default: () => row.target_id || '-' }) },
  { title: 'IP', key: 'ip', width: 130 },
  { title: '详情', key: 'metadata', width: 260, render: (row: AuditLog) => h(NEllipsis, { tooltip: true }, { default: () => stringifyJson(row.metadata) || '-' }) }
]

const archiveColumns = [
  { title: '归档时间', key: 'created_at', width: 220, render: (row: LogArchive) => formatAdminDateTime(row.created_at) },
  { title: '归档类型', key: 'archive_type', render: (row: LogArchive) => row.archive_type === 'model_call_logs' ? '模型调用日志' : displayValue(row.archive_type) },
  { title: '记录数', key: 'row_count', width: 160 }
]

const logsPagination = computed(() => ({
  page: logsPage.value,
  pageSize: logsPageSize.value,
  itemCount: logsTotal.value,
  pageCount: Math.max(1, Math.ceil(logsTotal.value / logsPageSize.value)),
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  prefix: ({ itemCount }: { itemCount: number }) => `共 ${itemCount} 条`
}))

const auditPagination = computed(() => ({
  page: auditPage.value,
  pageSize: auditPageSize.value,
  itemCount: auditTotal.value,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  prefix: ({ itemCount }: { itemCount: number }) => `共 ${itemCount} 条`
}))

const archivesPagination = computed(() => ({
  page: archivesPage.value,
  pageSize: archivesPageSize.value,
  itemCount: archivesTotal.value,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  prefix: ({ itemCount }: { itemCount: number }) => `共 ${itemCount} 个归档`
}))

function rowProps(row: ModelCallLog) {
  return {
    class: 'logs-table-row',
    tabindex: 0,
    onClick: () => openLog(row.id),
    onKeydown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        void openLog(row.id)
      }
    }
  }
}

function displayValue(value: unknown) {
  if (value == null || value === '') return '-'
  return String(value)
}

function displayUser(log: ModelCallLog) {
  return log.display_name || log.account || log.user_id || '-'
}

function formatCost(value: unknown) {
  const cost = Number(value)
  if (value === null || value === undefined || !Number.isFinite(cost) || cost < 0) return '-'
  if (cost === 0) return '0'
  return cost < 0.0001 ? String(cost) : cost.toFixed(6).replace(/0+$/g, '').replace(/\.$/, '')
}

function statusTagType(status?: string) {
  if (status === 'success') return 'success' as const
  if (status === 'failed' || status === 'error') return 'error' as const
  return 'info' as const
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasContent(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

function normalizeMediaUrl(value: string) {
  const trimmed = value.trim()
  const normalized = trimmed.startsWith('url:') ? trimmed.slice(4).trim() : trimmed
  if (/^https?:\/\//i.test(normalized)) return normalized
  if (/^data:(image|audio|video)\//i.test(normalized)) return normalized
  if (/^\/(?!\/)/.test(normalized)) return normalized
  return ''
}

function inferMediaKind(path: string, url = '', mimeType = ''): MediaKind | null {
  const normalizedMime = mimeType.toLowerCase()
  if (normalizedMime.startsWith('image/')) return 'image'
  if (normalizedMime.startsWith('audio/')) return 'audio'
  if (normalizedMime.startsWith('video/')) return 'video'

  const lowerUrl = url.toLowerCase()
  if (lowerUrl.startsWith('data:image/')) return 'image'
  if (lowerUrl.startsWith('data:audio/')) return 'audio'
  if (lowerUrl.startsWith('data:video/')) return 'video'

  try {
    const pathname = new URL(url, 'http://local').pathname.toLowerCase()
    if (/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/.test(pathname)) return 'image'
    if (/\.(mp3|wav|m4a|aac|ogg|flac|opus)$/.test(pathname)) return 'audio'
    if (/\.(mp4|webm|mov|mkv|avi|m4v|m3u8)$/.test(pathname)) return 'video'
  } catch {
    // Fall through to field-name inference.
  }

  const lowerPath = path.toLowerCase()
  if (/(audio_url|reference_audio|input_audio|audio|voice|speech|sound)/.test(lowerPath)) return 'audio'
  if (/(image_url|reference_image|image|avatar|thumbnail|cover|poster|picture|photo|first_frame|last_frame)/.test(lowerPath)) return 'image'
  if (/(video_url|reference_video|video|movie|clip)/.test(lowerPath)) return 'video'
  return null
}

function mediaKindLabel(kind: MediaKind) {
  return { image: '图片', audio: '音频', video: '视频' }[kind]
}

function mediaResourcesFor(direction: 'request' | 'response', payload: unknown): MediaResource[] {
  const resources: MediaResource[] = []
  const dedupe = new Set<string>()
  const seen = new WeakSet<object>()

  function add(resource: Omit<MediaResource, 'id'>) {
    const key = `${resource.kind}|${resource.url || ''}|${resource.path}`
    if (dedupe.has(key)) return
    dedupe.add(key)
    resources.push({ ...resource, id: `${direction}-media-${resources.length + 1}` })
  }

  const persistedRefs = Array.isArray(selectedLog.value?.media_refs) ? selectedLog.value.media_refs : []
  let persistedResourceCount = 0
  for (const item of persistedRefs) {
    if (!isRecord(item) || item.direction !== direction) continue
    const path = typeof item.path === 'string' ? item.path : '$'
    const url = typeof item.url === 'string' ? normalizeMediaUrl(item.url) : ''
    const mimeType = typeof item.mimeType === 'string' ? item.mimeType : ''
    const declaredKind = item.mediaType === 'image' || item.mediaType === 'audio' || item.mediaType === 'video'
      ? item.mediaType
      : null
    const kind = declaredKind || inferMediaKind(path, url, mimeType)
    if (!kind) continue
    add({
      kind,
      path,
      url: url || undefined,
      note: typeof item.note === 'string' ? item.note : undefined
    })
    persistedResourceCount += 1
  }

  // Persisted refs are the canonical media index. Scanning the payload as well
  // would list the same sanitized media object a second time at a child path.
  if (persistedResourceCount > 0) return resources

  function visit(value: unknown, path: string, depth: number) {
    if (value == null || depth > 10) return
    if (typeof value === 'string') {
      const url = normalizeMediaUrl(value)
      const kind = url ? inferMediaKind(path, url) : null
      if (url && kind) add({ kind, path, url })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1))
      return
    }
    if (!isRecord(value) || seen.has(value)) return
    seen.add(value)

    const sanitizedKind = value.kind === 'data-url' || value.kind === 'large-media-or-inline-string'
    if (sanitizedKind) {
      const preview = typeof value.preview === 'string' ? value.preview : ''
      const kind = inferMediaKind(path, preview)
      if (kind) {
        const chars = typeof value.chars === 'number' ? value.chars.toLocaleString() : ''
        add({
          kind,
          path,
          note: chars ? `媒体内容已脱敏，原始长度 ${chars} 字符` : '媒体内容已脱敏，无法预览'
        })
      }
      return
    }

    for (const [key, child] of Object.entries(value)) {
      visit(child, `${path}.${key}`, depth + 1)
    }
  }

  visit(payload, '$', 0)
  return resources
}

function stringifyJson(value: unknown) {
  if (!hasContent(value)) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function stringifyRawJson(value: unknown) {
  if (!hasContent(value)) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function payloadValue(kind: JsonPayloadKind) {
  return selectedLog.value?.[kind]
}

function rawPayloadText(kind: JsonPayloadKind) {
  const raw = selectedLog.value?.[`${kind}_json`]
  return typeof raw === 'string' ? raw : ''
}

function jsonTextForPayload(kind: JsonPayloadKind) {
  return rawPayloadText(kind) || stringifyRawJson(payloadValue(kind))
}

function valueToText(value: unknown): string {
  if (!hasContent(value)) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every(isMessageLike)) {
    return value
      .map((item, index) => {
        const role = displayValue(item.role)
        return `#${index + 1} ${role}\n${valueToText(item.content)}`
      })
      .join('\n\n')
  }
  return stringifyJson(value)
}

function isMessageLike(value: unknown): value is { role?: unknown, content?: unknown } {
  return isRecord(value) && ('role' in value || 'content' in value)
}

function findFirstByKeys(value: unknown, keys: string[], depth = 0, skipKeys = new Set<string>()): unknown {
  if (depth > 4 || !hasContent(value)) return undefined
  if (isRecord(value)) {
    for (const key of keys) {
      if (hasContent(value[key])) return value[key]
    }
    for (const [key, child] of Object.entries(value)) {
      if (skipKeys.has(key)) continue
      const result = findFirstByKeys(child, keys, depth + 1, skipKeys)
      if (hasContent(result)) return result
    }
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const result = findFirstByKeys(child, keys, depth + 1, skipKeys)
      if (hasContent(result)) return result
    }
  }
  return undefined
}

function textFingerprints(content: string) {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
  const withoutMessageHeaders = content.replace(/^#\d+\s+[^\n]*\n/gm, '')
  return [normalize(content), normalize(withoutMessageHeaders)].filter(Boolean)
}

function readableBlocksFor(value: unknown, type: 'request' | 'response'): TextBlock[] {
  const candidates = type === 'request'
    ? [
        { title: '消息', keys: ['messages'] },
        { title: '提示词', keys: ['prompt'] },
        { title: '输入', keys: ['input', 'text', 'content'] },
        { title: '参数', keys: ['parameters', 'params', 'options'] }
      ]
    : [
        { title: '输出', keys: ['output', 'result', 'text', 'content', 'message'] },
        { title: '结果地址', keys: ['imageUrl', 'image_url', 'videoUrl', 'video_url', 'audioUrl', 'audio_url', 'fileUrl', 'file_url', 'url'] },
        { title: '媒体类型', keys: ['mimeType', 'mime_type', 'contentType', 'content_type'] },
        { title: '候选结果', keys: ['choices', 'data'] },
        { title: '用量', keys: ['usage'] }
      ]
  const blocks: TextBlock[] = []
  const seen = new Set<string>()
  const skipKeys = type === 'request' ? new Set(['messages']) : new Set<string>()

  for (const candidate of candidates) {
    const matched = findFirstByKeys(value, candidate.keys, 0, candidate.title === '消息' ? new Set<string>() : skipKeys)
    const content = valueToText(matched)
    const fingerprints = textFingerprints(content)
    if (!content || fingerprints.some(fingerprint => seen.has(fingerprint))) continue
    blocks.push({ title: candidate.title, content })
    for (const fingerprint of fingerprints) {
      seen.add(fingerprint)
    }
  }

  if (blocks.length === 0 && hasContent(value)) {
    blocks.push({ title: type === 'request' ? '请求内容' : '响应内容', content: valueToText(value) })
  }

  return blocks
}

async function copyText(text: string, label: string) {
  if (!text || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(text)
    message.success(`${label}已复制`)
  } catch {
    message.error('复制失败')
  }
}

async function loadLogs() {
  pending.value = true
  logsError.value = ''
  try {
    const response = await $fetch<{ data: {
      logs: ModelCallLog[]
      pagination: { total: number }
      summary: LogSummary
      options: LogOptions
    } }>('/api/admin/model-call-logs', {
      query: callQuery(logsPage.value, logsPageSize.value)
    })
    logs.value = response.data.logs
    logsTotal.value = Number(response.data.pagination.total)
    Object.assign(summary, response.data.summary)
    Object.assign(logOptions, response.data.options)
    lastUpdated.value = new Date()
  } catch (error) {
    logsError.value = errorText(error, '调用日志加载失败')
  } finally {
    pending.value = false
  }
}

function callQuery(page: number, pageSize: number) {
  const [sortBy, sortOrder] = filters.sortBy.split(':')
  return {
    page,
    pageSize,
    keyword: keyword.value || undefined,
    status: filters.status || undefined,
    userId: filters.userId || undefined,
    provider: filters.provider || undefined,
    modelId: filters.modelId || undefined,
    operation: filters.operation || undefined,
    minDuration: filters.minDuration ?? undefined,
    maxDuration: filters.maxDuration ?? undefined,
    startAt: dateRange.value ? new Date(dateRange.value[0]).toISOString() : undefined,
    endAt: dateRange.value ? new Date(dateRange.value[1]).toISOString() : undefined,
    sortBy,
    sortOrder
  }
}

function auditQuery(page: number, pageSize: number) {
  return {
    page,
    pageSize,
    keyword: auditKeyword.value || undefined,
    startAt: auditDateRange.value ? new Date(auditDateRange.value[0]).toISOString() : undefined,
    endAt: auditDateRange.value ? new Date(auditDateRange.value[1]).toISOString() : undefined
  }
}

function errorText(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const candidate = error as { data?: { statusMessage?: string, message?: string }, message?: string }
    return candidate.data?.statusMessage || candidate.data?.message || candidate.message || fallback
  }
  return fallback
}

async function loadAuditLogs() {
  auditLoading.value = true
  auditError.value = ''
  try {
    const response = await $fetch<{ data: { logs: AuditLog[], pagination: { total: number } } }>('/api/admin/audit-logs', {
      query: auditQuery(auditPage.value, auditPageSize.value)
    })
    auditLogs.value = response.data.logs
    auditTotal.value = Number(response.data.pagination.total)
    lastUpdated.value = new Date()
  } catch (error) {
    auditError.value = errorText(error, '操作审计加载失败')
  } finally {
    auditLoading.value = false
  }
}

async function loadArchives() {
  archivesLoading.value = true
  archivesError.value = ''
  try {
    const response = await $fetch<{ data: { archives: LogArchive[], pagination: { total: number } } }>('/api/admin/log-archives', {
      query: { page: archivesPage.value, pageSize: archivesPageSize.value }
    })
    archives.value = response.data.archives
    archivesTotal.value = Number(response.data.pagination.total)
    lastUpdated.value = new Date()
  } catch (error) {
    archivesError.value = errorText(error, '归档记录加载失败')
  } finally {
    archivesLoading.value = false
  }
}

function refreshLogsFromFirstPage() {
  logsPage.value = 1
  syncRouteQuery()
  void loadLogs()
}

function resetCallFilters() {
  keyword.value = ''
  Object.assign(filters, {
    status: null,
    userId: null,
    provider: null,
    modelId: null,
    operation: null,
    minDuration: null,
    maxDuration: null,
    sortBy: 'createdAt:desc'
  })
  dateRange.value = null
  refreshLogsFromFirstPage()
}

function handleLogsPageChange(page: number) {
  logsPage.value = page
  void loadLogs()
}

function handleLogsPageSizeChange(pageSize: number) {
  logsPageSize.value = pageSize
  logsPage.value = 1
  void loadLogs()
}

function refreshAuditFromFirstPage() {
  auditPage.value = 1
  syncRouteQuery()
  void loadAuditLogs()
}

function resetAuditFilters() {
  auditKeyword.value = ''
  auditDateRange.value = null
  refreshAuditFromFirstPage()
}

function handleAuditPageChange(page: number) {
  auditPage.value = page
  void loadAuditLogs()
}

function handleAuditPageSizeChange(pageSize: number) {
  auditPageSize.value = pageSize
  auditPage.value = 1
  void loadAuditLogs()
}

function handleArchivesPageChange(page: number) {
  archivesPage.value = page
  void loadArchives()
}

function handleArchivesPageSizeChange(pageSize: number) {
  archivesPageSize.value = pageSize
  archivesPage.value = 1
  void loadArchives()
}

function refreshActiveTab() {
  if (activeTab.value === 'calls') return void loadLogs()
  if (activeTab.value === 'audit') return void loadAuditLogs()
  return void loadArchives()
}

function handleTabChange(value: string) {
  activeTab.value = value as typeof activeTab.value
  syncRouteQuery()
  if (value === 'audit' && auditLogs.value.length === 0) void loadAuditLogs()
  if (value === 'archives' && archives.value.length === 0) void loadArchives()
}

function syncRouteQuery() {
  const query: Record<string, string> = { tab: activeTab.value }
  if (activeTab.value === 'calls') {
    const values = callQuery(1, logsPageSize.value)
    for (const [key, value] of Object.entries(values)) {
      if (!['page', 'pageSize'].includes(key) && value !== undefined) query[key] = String(value)
    }
  } else if (activeTab.value === 'audit') {
    const values = auditQuery(1, auditPageSize.value)
    for (const [key, value] of Object.entries(values)) {
      if (!['page', 'pageSize'].includes(key) && value !== undefined) query[key] = String(value)
    }
  }
  void router.replace({ query })
}

function restoreRouteQuery() {
  const tab = String(route.query.tab || '')
  if (['calls', 'audit', 'archives'].includes(tab)) activeTab.value = tab as typeof activeTab.value
  const value = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
  if (activeTab.value === 'calls') {
    keyword.value = value('keyword')
    filters.status = value('status') || null
    filters.userId = value('userId') || null
    filters.provider = value('provider') || null
    filters.modelId = value('modelId') || null
    filters.operation = value('operation') || null
    filters.minDuration = value('minDuration') ? Number(value('minDuration')) : null
    filters.maxDuration = value('maxDuration') ? Number(value('maxDuration')) : null
    filters.sortBy = `${value('sortBy') || 'createdAt'}:${value('sortOrder') || 'desc'}`
    if (value('startAt') && value('endAt')) dateRange.value = [Date.parse(value('startAt')), Date.parse(value('endAt'))]
  } else if (activeTab.value === 'audit') {
    auditKeyword.value = value('keyword')
    if (value('startAt') && value('endAt')) auditDateRange.value = [Date.parse(value('startAt')), Date.parse(value('endAt'))]
  }
}

function csvCell(value: unknown) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const content = `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n')}`
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function exportActiveResults() {
  exporting.value = true
  try {
    if (activeTab.value === 'calls') {
      const all: ModelCallLog[] = []
      const pages = Math.max(1, Math.ceil(logsTotal.value / 100))
      for (let page = 1; page <= pages; page += 1) {
        const response = await $fetch<{ data: { logs: ModelCallLog[] } }>('/api/admin/model-call-logs', { query: { ...callQuery(page, 100), includeOptions: false } })
        all.push(...response.data.logs)
      }
      downloadCsv(`model-call-logs-${new Date().toISOString().slice(0, 10)}.csv`,
        ['时间', '用户', 'Request ID', '供应商', '模型', '操作', '状态', '耗时 ms', '费用', '积分', '项目', '场景', '错误'],
        all.map(row => [row.created_at, displayUser(row), row.request_id, row.provider, row.model_id, row.operation, row.status, row.duration_ms, row.estimated_cost, row.credits_charged, row.project_id, row.scene_id, row.error_message]))
    } else {
      const all: AuditLog[] = []
      const pages = Math.max(1, Math.ceil(auditTotal.value / 100))
      for (let page = 1; page <= pages; page += 1) {
        const response = await $fetch<{ data: { logs: AuditLog[] } }>('/api/admin/audit-logs', { query: auditQuery(page, 100) })
        all.push(...response.data.logs)
      }
      downloadCsv(`audit-logs-${new Date().toISOString().slice(0, 10)}.csv`,
        ['时间', '管理员', '操作', '目标类型', '目标', 'IP', 'User Agent', '详情'],
        all.map(row => [row.created_at, row.display_name || row.account || row.actor_user_id, row.action, row.target_type, row.target_id, row.ip, row.user_agent, row.metadata]))
    }
    message.success('日志已导出')
  } catch (error) {
    message.error(errorText(error, '导出失败'))
  } finally {
    exporting.value = false
  }
}

async function openLog(id: string) {
  const requestSequence = ++detailRequestSequence
  selectedLog.value = null
  activeDetailTab.value = 'request'
  detailLoading.value = true
  drawer.value = true
  try {
    const response = await $fetch<{ data: { log: ModelCallLog } }>(`/api/admin/model-call-logs/${id}`)
    if (requestSequence !== detailRequestSequence) return
    selectedLog.value = response.data.log
    Object.assign(payloadViewModes, { request: 'text', response: 'text', error: 'text' })
  } catch (error) {
    if (requestSequence === detailRequestSequence) message.error(errorText(error, '日志详情加载失败'))
  } finally {
    if (requestSequence === detailRequestSequence) detailLoading.value = false
  }
}

function syncRefreshTimer(enabled: boolean) {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = enabled
    ? setInterval(() => {
        if (document.visibilityState === 'visible' && !activeLoading.value) refreshActiveTab()
      }, 30_000)
    : null
}

watch(autoRefresh, (enabled) => {
  syncRefreshTimer(enabled)
})

onMounted(() => {
  restoreRouteQuery()
  refreshActiveTab()
})

onActivated(() => {
  syncRefreshTimer(autoRefresh.value)
})

onDeactivated(() => {
  syncRefreshTimer(false)
})

onBeforeUnmount(() => {
  syncRefreshTimer(false)
})
</script>

<style scoped>
.logs-page {
  box-sizing: border-box;
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  padding: 8px 12px 12px;
}

.logs-toolbar,
.auto-refresh-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.refresh-status,
.auto-refresh-control {
  color: #667085;
  font-size: 12px;
}

.logs-tabs {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.logs-tabs :deep(.n-tabs-nav) {
  flex: 0 0 auto;
  margin-bottom: 8px;
}

.logs-tabs :deep(.n-tabs-pane-wrapper) {
  min-height: 0;
  flex: 1;
}

.logs-tabs :deep(.n-tab-pane) {
  box-sizing: border-box;
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.logs-data-table {
  height: 0;
  min-height: 180px;
  flex: 1;
}

.logs-data-table :deep(.n-data-table-wrapper),
.logs-data-table :deep(.n-data-table-base-table) {
  min-height: 0;
}

.logs-data-table :deep(.n-data-table__pagination) {
  flex: 0 0 auto;
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 8px;
  border-top: 1px solid #e4e7ec;
  border-bottom: 1px solid #e4e7ec;
  background: #fff;
}

.summary-metric {
  display: grid;
  gap: 2px;
  padding: 8px 14px;
  border-right: 1px solid #e4e7ec;
}

.summary-metric:last-child {
  border-right: 0;
}

.summary-metric span {
  color: #667085;
  font-size: 12px;
}

.summary-metric strong {
  color: #1d2939;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}

.summary-metric--danger strong {
  color: #c4320a;
}

.filter-panel {
  display: grid;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid #e4e7ec;
  border-radius: 6px;
  background: #fff;
}

.filter-row,
.filter-panel--single {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-row > :deep(.n-select) {
  width: 150px;
}

.filter-search {
  min-width: 260px;
  flex: 1;
}

.date-filter {
  width: 360px;
}

.filter-row--secondary :deep(.n-input-number) {
  width: 150px;
}

.sort-filter {
  width: 180px;
  margin-left: auto;
}

.range-separator {
  color: #98a2b3;
  font-size: 12px;
}

.state-alert,
.archive-note {
  margin-bottom: 12px;
}

:deep(.request-id-button) {
  display: flex;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  justify-content: flex-start;
  overflow: hidden;
  color: #175cd3;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.request-id-button .n-button__content) {
  display: block;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-align: left;
}

:deep(.request-id-text) {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-spin,
.detail-spin :deep(.n-spin-content) {
  height: 100%;
  min-height: 0;
}

.json-view {
  max-height: 420px;
  overflow: auto;
  padding: 12px;
  border-radius: 6px;
  background: #101828;
  color: #f2f4f7;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.json-view--tall {
  max-height: 64vh;
}

.log-detail {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
}

.log-detail-tabs {
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.log-detail-tabs :deep(.n-tab-pane) {
  box-sizing: border-box;
  display: flex;
  height: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.log-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.log-summary-item {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 34px;
  gap: 8px;
  border: 1px solid rgb(239, 239, 245);
  border-radius: 6px;
  padding: 7px 9px;
  background: #fafafa;
  color: #1f2937;
  font-size: 13px;
}

.log-summary-item > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-summary-item--wide {
  grid-column: span 2;
}

.log-summary-label {
  flex: 0 0 auto;
  color: #667085;
}

.log-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

.log-error-message {
  white-space: pre-wrap;
  word-break: break-word;
}

.log-detail-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.log-detail-stack {
  display: flex;
  height: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.log-text-blocks {
  display: grid;
  align-content: start;
  gap: 10px;
  padding-top: 18px;
}

.log-text-block {
  display: grid;
  align-content: start;
  gap: 6px;
}

.log-media-section {
  display: grid;
  gap: 8px;
}

.log-media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 10px;
}

.log-media-card {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border: 1px solid #e4e7ec;
  border-radius: 6px;
  background: #f9fafb;
}

.log-media-card-header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  color: #344054;
  font-size: 12px;
}

.log-media-card-header > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.log-media-card-header span {
  overflow-wrap: anywhere;
  color: #667085;
}

.log-media-card-header a {
  flex: 0 0 auto;
  color: #175cd3;
}

.log-media-card img,
.log-media-card video {
  width: 100%;
  max-height: 360px;
  border-radius: 4px;
  background: #111827;
  object-fit: contain;
}

.log-media-card audio {
  width: 100%;
}

.log-media-unavailable {
  padding: 12px;
  border: 1px dashed #d0d5dd;
  border-radius: 4px;
  color: #667085;
  font-size: 12px;
}

.log-payload-panel {
  display: flex;
  height: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  border: 1px solid rgb(239, 239, 245);
  border-radius: 6px;
  background: #fff;
  overflow: hidden;
}

.log-payload-header {
  display: flex;
  min-height: 52px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  color: #1f2328;
  font-size: 16px;
  font-weight: 600;
}

.log-payload-body {
  height: 0;
  min-height: 0;
  flex: 1;
  padding: 0 18px 18px;
  overflow-x: auto;
  overflow-y: scroll;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.log-payload-body .json-view,
.log-payload-body .log-error-block,
.log-payload-body .log-text-block pre {
  min-height: 0;
  max-height: none;
}

.log-block-header {
  display: flex;
  min-height: 28px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.log-block-title {
  color: #667085;
  font-size: 12px;
}

.log-text-block pre,
.log-error-block {
  max-height: 280px;
  overflow: auto;
  margin: 0;
  border-radius: 6px;
  padding: 10px 12px;
  background: #f6f7f9;
  color: #1f2937;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.log-empty {
  border: 1px dashed rgb(224, 224, 230);
  border-radius: 6px;
  padding: 24px;
  color: #98a2b3;
  text-align: center;
}

:deep(.logs-table-row) {
  cursor: pointer;
}

:deep(.logs-table-row:hover td) {
  background: rgba(24, 160, 88, 0.06);
}

:deep(.n-data-table-th),
:deep(.n-data-table-th__title) {
  white-space: nowrap;
}

:deep(.logs-table-row:focus-visible td) {
  background: rgba(23, 92, 211, 0.08);
  outline: 2px solid #175cd3;
  outline-offset: -2px;
}

@media (max-width: 1100px) {
  .logs-toolbar .refresh-status {
    display: none;
  }
}

@media (max-width: 860px) {
  .logs-page {
    overflow: auto;
  }

  .logs-tabs {
    min-height: auto;
    flex: 0 0 auto;
  }

  .logs-tabs :deep(.n-tabs-pane-wrapper),
  .logs-tabs :deep(.n-tab-pane) {
    height: auto;
    overflow: visible;
  }

  .logs-data-table {
    height: 520px;
    flex: 0 0 auto;
  }

  .filter-row,
  .filter-panel--single {
    align-items: stretch;
    flex-direction: column;
  }

  .logs-toolbar .auto-refresh-control {
    display: none;
  }

  .summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .summary-metric:nth-child(2) {
    border-right: 0;
  }

  .filter-search,
  .date-filter,
  .sort-filter,
  .filter-row > :deep(.n-select),
  .filter-row--secondary :deep(.n-input-number) {
    width: 100%;
    min-width: 0;
  }

  .sort-filter {
    margin-left: 0;
  }

  .range-separator {
    display: none;
  }

  .log-detail {
    height: auto;
    overflow: visible;
  }

  .log-detail-tabs,
  .log-detail-tabs :deep(.n-tab-pane),
  .log-detail-stack {
    height: auto;
    overflow: visible;
  }

  .log-payload-panel {
    height: auto;
    overflow: visible;
  }

  .log-payload-body {
    height: auto;
    overflow: visible;
  }

  .log-payload-body .json-view,
  .log-payload-body .log-error-block,
  .log-text-block pre {
    max-height: 280px;
  }

  .log-summary-grid {
    grid-template-columns: 1fr;
  }

  .log-summary-item--wide {
    grid-column: auto;
  }
}
</style>
