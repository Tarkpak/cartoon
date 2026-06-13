<template>
  <AdminShell>
    <div class="page">
      <n-space vertical class="table-section">
        <n-input v-model:value="keyword" placeholder="搜索 request id、错误、用户" clearable @keyup.enter="loadLogs" />
        <n-data-table
          :columns="columns"
          :data="logs"
          :loading="pending"
          :row-props="rowProps"
        />
      </n-space>

      <n-drawer v-model:show="drawer" :width="detailDrawerWidth">
        <n-drawer-content title="日志详情">
          <div v-if="selectedLog" class="log-detail">
            <div class="log-summary-grid">
              <div class="log-summary-item">
                <span class="log-summary-label">状态</span>
                <n-tag size="small" :type="statusTagType(selectedLog.status)">
                  {{ selectedLog.status || '-' }}
                </n-tag>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">时间</span>
                <span>{{ formatAdminDateTime(selectedLog.created_at) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">耗时</span>
                <span>{{ formatDuration(selectedLog.duration_ms) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">用户</span>
                <span>{{ displayUser(selectedLog) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">供应商</span>
                <span>{{ displayValue(selectedLog.provider) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">模型</span>
                <span>{{ displayValue(selectedLog.model_id) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">操作</span>
                <span>{{ displayValue(selectedLog.operation) }}</span>
              </div>
              <div class="log-summary-item">
                <span class="log-summary-label">费用</span>
                <span>{{ formatCost(selectedLog.estimated_cost) }}</span>
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

            <n-tabs type="line" animated>
              <n-tab-pane name="request" tab="请求">
                <div class="log-detail-stack">
                  <div class="log-detail-toolbar">
                    <span class="log-summary-label">请求展示</span>
                    <n-button
                      size="small"
                      :type="payloadViewModes.request === 'text' ? 'primary' : 'default'"
                      @click="payloadViewModes.request = 'text'"
                    >
                      格式化文本
                    </n-button>
                    <n-button
                      size="small"
                      :type="payloadViewModes.request === 'json' ? 'primary' : 'default'"
                      @click="payloadViewModes.request = 'json'"
                    >
                      原始 JSON
                    </n-button>
                  </div>
                  <n-card v-if="payloadViewModes.request === 'text'" size="small" title="请求内容">
                    <div class="log-text-blocks">
                      <section
                        v-for="block in requestTextBlocks"
                        :key="block.title"
                        class="log-text-block"
                      >
                        <div class="log-block-title">{{ block.title }}</div>
                        <pre>{{ block.content }}</pre>
                      </section>
                      <div v-if="requestTextBlocks.length === 0" class="log-empty">无可读请求内容</div>
                    </div>
                  </n-card>
                  <n-card v-else size="small" title="请求 JSON">
                    <template #header-extra>
                      <n-button size="tiny" quaternary @click="copyText(jsonTextForPayload('request'), '请求 JSON')">复制</n-button>
                    </template>
                    <pre v-if="hasContent(jsonTextForPayload('request'))" class="json-view">{{ jsonTextForPayload('request') }}</pre>
                    <div v-else class="log-empty">无请求数据</div>
                  </n-card>
                </div>
              </n-tab-pane>

              <n-tab-pane name="response" tab="响应">
                <div class="log-detail-stack">
                  <div class="log-detail-toolbar">
                    <span class="log-summary-label">响应展示</span>
                    <n-button
                      size="small"
                      :type="payloadViewModes.response === 'text' ? 'primary' : 'default'"
                      @click="payloadViewModes.response = 'text'"
                    >
                      格式化文本
                    </n-button>
                    <n-button
                      size="small"
                      :type="payloadViewModes.response === 'json' ? 'primary' : 'default'"
                      @click="payloadViewModes.response = 'json'"
                    >
                      原始 JSON
                    </n-button>
                  </div>
                  <n-card v-if="payloadViewModes.response === 'text'" size="small" title="响应内容">
                    <div class="log-text-blocks">
                      <section
                        v-for="block in responseTextBlocks"
                        :key="block.title"
                        class="log-text-block"
                      >
                        <div class="log-block-title">{{ block.title }}</div>
                        <pre>{{ block.content }}</pre>
                      </section>
                      <div v-if="responseTextBlocks.length === 0" class="log-empty">无可读响应内容</div>
                    </div>
                  </n-card>
                  <n-card v-else size="small" title="响应 JSON">
                    <template #header-extra>
                      <n-button size="tiny" quaternary @click="copyText(jsonTextForPayload('response'), '响应 JSON')">复制</n-button>
                    </template>
                    <pre v-if="hasContent(jsonTextForPayload('response'))" class="json-view">{{ jsonTextForPayload('response') }}</pre>
                    <div v-else class="log-empty">无响应数据</div>
                  </n-card>
                </div>
              </n-tab-pane>

              <n-tab-pane name="error" tab="错误">
                <div class="log-detail-stack">
                  <div class="log-detail-toolbar">
                    <span class="log-summary-label">错误展示</span>
                    <n-button
                      size="small"
                      :type="payloadViewModes.error === 'text' ? 'primary' : 'default'"
                      @click="payloadViewModes.error = 'text'"
                    >
                      格式化文本
                    </n-button>
                    <n-button
                      size="small"
                      :type="payloadViewModes.error === 'json' ? 'primary' : 'default'"
                      @click="payloadViewModes.error = 'json'"
                    >
                      原始 JSON
                    </n-button>
                  </div>
                  <n-card v-if="payloadViewModes.error === 'text'" size="small" title="错误摘要">
                    <pre class="log-error-block">{{ selectedLog.error_message }}</pre>
                    <div v-if="!selectedLog.error_message" class="log-empty">无错误摘要</div>
                  </n-card>
                  <n-card v-else size="small" title="错误 JSON">
                    <template #header-extra>
                      <n-button size="tiny" quaternary @click="copyText(jsonTextForPayload('error'), '错误 JSON')">复制</n-button>
                    </template>
                    <pre v-if="hasContent(jsonTextForPayload('error'))" class="json-view">{{ jsonTextForPayload('error') }}</pre>
                    <div v-else class="log-empty">无错误数据</div>
                  </n-card>
                </div>
              </n-tab-pane>

              <n-tab-pane name="raw" tab="原始数据">
                <n-card size="small" title="完整日志">
                  <template #header-extra>
                    <n-button size="tiny" quaternary @click="copyText(selectedLogJson, '完整日志')">复制</n-button>
                  </template>
                  <pre class="json-view json-view--tall">{{ selectedLogJson }}</pre>
                </n-card>
              </n-tab-pane>
            </n-tabs>
          </div>
        </n-drawer-content>
      </n-drawer>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NTag, useMessage } from 'naive-ui'

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
  error_message?: string
  created_at?: string
  request_json?: string
  response_json?: string
  error_json?: string
  request?: unknown
  response?: unknown
  error?: unknown
  [key: string]: unknown
}

interface TextBlock {
  title: string
  content: string
}

type JsonPayloadKind = 'request' | 'response' | 'error'
type PayloadViewMode = 'text' | 'json'

const message = useMessage()
const keyword = ref('')
const pending = ref(false)
const logs = ref<ModelCallLog[]>([])
const drawer = ref(false)
const selectedLog = ref<ModelCallLog | null>(null)
const payloadViewModes = reactive<Record<JsonPayloadKind, PayloadViewMode>>({
  request: 'text',
  response: 'text',
  error: 'text'
})
const detailDrawerWidth = 'min(1080px, 92vw)'

const selectedLogJson = computed(() => selectedLog.value ? stringifyJson(selectedLog.value) : '')
const requestTextBlocks = computed(() => selectedLog.value ? readableBlocksFor(selectedLog.value.request, 'request') : [])
const responseTextBlocks = computed(() => selectedLog.value ? readableBlocksFor(selectedLog.value.response, 'response') : [])

const columns = [
  {
    title: '时间',
    key: 'created_at',
    width: 180,
    render(row: ModelCallLog) {
      return formatAdminDateTime(row.created_at)
    }
  },
  { title: '用户', key: 'account' },
  { title: '供应商', key: 'provider' },
  { title: '模型', key: 'model_id' },
  { title: '操作', key: 'operation' },
  {
    title: '状态',
    key: 'status',
    render(row: ModelCallLog) {
      return h(NTag, { size: 'small', type: statusTagType(row.status) }, { default: () => row.status || '-' })
    }
  },
  { title: '耗时 ms', key: 'duration_ms' }
]

function rowProps(row: ModelCallLog) {
  return {
    class: 'logs-table-row',
    onClick: () => openLog(row.id)
  }
}

function displayValue(value: unknown) {
  if (value == null || value === '') return '-'
  return String(value)
}

function displayUser(log: ModelCallLog) {
  return log.display_name || log.account || log.user_id || '-'
}

function formatDuration(value: unknown) {
  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? `${duration} ms` : '-'
}

function formatCost(value: unknown) {
  const cost = Number(value)
  if (!Number.isFinite(cost) || cost <= 0) return '-'
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

function valueToText(value: unknown) {
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

  if (blocks.length === 0 && hasContent(value) && !isRecord(value)) {
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
  try {
    const response = await $fetch<{ data: { logs: ModelCallLog[] } }>('/api/admin/model-call-logs', {
      query: { keyword: keyword.value }
    })
    logs.value = response.data.logs
  } finally {
    pending.value = false
  }
}

async function openLog(id: string) {
  const response = await $fetch<{ data: { log: ModelCallLog } }>(`/api/admin/model-call-logs/${id}`)
  selectedLog.value = response.data.log
  Object.assign(payloadViewModes, { request: 'text', response: 'text', error: 'text' })
  drawer.value = true
}

onMounted(loadLogs)
</script>

<style scoped>
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
  display: grid;
  gap: 14px;
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
  display: grid;
  gap: 12px;
}

.log-text-blocks {
  display: grid;
  gap: 10px;
}

.log-text-block {
  display: grid;
  gap: 6px;
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

@media (max-width: 860px) {
  .log-summary-grid {
    grid-template-columns: 1fr;
  }

  .log-summary-item--wide {
    grid-column: auto;
  }
}
</style>
