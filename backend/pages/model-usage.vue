<template>
  <AdminShell>
    <div class="page usage-page">
      <header class="usage-header">
        <div><h1>用量与费用</h1><p class="muted">查看已同步的客户端调用，日期按北京时间统计。</p></div>
        <n-button :loading="loading" @click="load">刷新</n-button>
      </header>
      <n-alert type="info" :bordered="false">费用为客户端上报的估算，美元与人民币分开统计，不做汇率换算。DeepSeek 使用官方高峰参考价，通义使用北京地域公开原价，不扣除优惠。仅涵盖已同步记录，不代表供应商账单，也不参与平台积分扣费。</n-alert>
      <section class="usage-filters" aria-label="用量筛选">
        <label>币种<select v-model="filters.currency" aria-label="币种"><option value="USD">美元 USD</option><option value="CNY">人民币 CNY</option></select></label>
        <label>开始日期<input v-model="filters.startDate" type="date"></label>
        <label>结束日期<input v-model="filters.endDate" type="date"></label>
        <label>用户<n-select v-model:value="filters.userId" clearable filterable placeholder="全部用户" :options="data?.options.users || []" /></label>
        <label>供应商<n-select v-model:value="filters.provider" clearable filterable placeholder="全部供应商" :options="providerOptions" /></label>
        <label>模型<n-select v-model:value="filters.model" clearable filterable placeholder="全部模型" :options="modelOptions" /></label>
        <label>项目 ID<n-input v-model:value="filters.projectId" clearable placeholder="全部项目" @keyup.enter="search" /></label>
        <div class="usage-actions"><n-button type="primary" :loading="loading" @click="search">查询</n-button><n-button @click="reset">重置</n-button></div>
      </section>
      <n-alert v-if="error" type="error" :bordered="false">{{ error }} <n-button text @click="load">重试</n-button></n-alert>
      <template v-if="data && !error">
        <section class="usage-metrics" aria-label="筛选范围汇总" :aria-busy="loading">
          <div><span>调用次数</span><strong>{{ count(data.total.calls) }}</strong><small>用量未知 {{ count(data.total.unknownCalls) }} 次</small></div>
          <div><span>输入 token</span><strong>{{ count(data.total.inputTokens) }}</strong><small>仅累加已知数量，含缓存输入</small></div>
          <div><span>输出 token</span><strong>{{ count(data.total.outputTokens) }}</strong><small>推理 token 包含在输出中</small></div>
          <div><span>已估价费用 · {{ applied.currency }}</span><strong>{{ money(amount(data.total)) }}</strong><small>估价覆盖 {{ count(data.total.pricedCalls) }} / {{ count(data.total.calls) }} 次</small></div>
        </section>
        <div class="usage-rankings">
          <section><h2>用户费用排行 <small>前 20 名</small></h2><n-data-table :columns="groupColumns" :data="data.users" :loading="loading" :scroll-x="560" size="small" :max-height="320" /></section>
          <section><h2>供应商 / 模型对比 <small>费用前 20 项</small></h2><n-data-table :columns="groupColumns" :data="data.models" :loading="loading" :scroll-x="560" size="small" :max-height="320" /></section>
        </div>
        <section>
          <h2>调用明细</h2>
          <n-data-table :columns="detailColumns" :data="data.records" :loading="loading" :scroll-x="1900" :row-key="rowKey" size="small" remote :pagination="pagination" @update:page="changePage">
            <template #empty><n-empty description="没有符合条件的已同步用量记录" /></template>
          </n-data-table>
        </section>
      </template>
      <n-skeleton v-else-if="loading" height="180px" />
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { NSkeleton, type DataTableColumns } from 'naive-ui'
import type { AdminUsageData, UsageDetail, UsageGroup } from '../utils/model-usage-types'
import { logUsageCost, logUsageTokens } from '@playlet-shared/utils/model-usage-display'

const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const defaults = () => ({ currency: 'USD', startDate: `${today.slice(0, 7)}-01`, endDate: today, userId: null as string | null, provider: null as string | null, model: null as string | null, projectId: '' })
const filters = reactive(defaults())
const applied = ref({ ...filters })
const data = ref<AdminUsageData | null>(null)
const loading = ref(false)
const error = ref('')
const page = ref(1)
let request = 0
const count = (n: number | null) => n == null ? '未知' : n.toLocaleString('zh-CN')
const money = (n: number | null) => logUsageCost({ currency: applied.value.currency, costNanoUsd: n, costNanoCny: n })
const amount = (r: { costNanoUsd: number, costNanoCny: number }) => applied.value.currency === 'CNY' ? r.costNanoCny : r.costNanoUsd
const providerOptions = computed(() => (data.value?.options.providers || []).map(value => ({ label: value, value })))
const modelOptions = computed(() => (data.value?.options.models || []).map(value => ({ label: value, value })))
const pagination = computed(() => ({ page: page.value, pageSize: 50, itemCount: data.value?.pagination.total || 0 }))
const rowKey = (row: UsageDetail) => JSON.stringify([row.userId, row.id])
const groupColumns: DataTableColumns<UsageGroup> = [
  { title: '名称', key: 'label', minWidth: 180, ellipsis: { tooltip: true } },
  { title: '调用', key: 'calls', width: 70, render: r => count(r.calls) },
  { title: '估价覆盖', key: 'pricedCalls', width: 90, render: r => `${r.pricedCalls}/${r.calls}` },
  { title: '费用', key: 'costNanoUsd', width: 120, render: r => money(amount(r)) },
  { title: '单次均价', key: 'average', width: 120, render: r => money(r.pricedCalls ? amount(r) / r.pricedCalls : null) }
]
const statuses: Record<string, string> = { success: '成功', error: '失败', failed: '失败', cancelled: '已取消', unknown: '未知' }
const stages: Record<string, string> = { generateText: '文本生成 / 剧本解析', generateImage: '图片生成 / 编辑', generateVideo: '视频生成', scene_detail: '分镜细化', video_review: '视频审查' }
const detailColumns: DataTableColumns<UsageDetail> = [
  { title: '时间（北京时间）', key: 'createdAt', width: 180, render: r => new Date(r.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) },
  { title: '用户', key: 'userName', width: 140, ellipsis: { tooltip: true } },
  { title: '供应商实例', key: 'providerInstanceName', width: 160, render: r => r.providerInstanceName || `${r.provider || '未知'}（历史未区分）` },
  { title: '模型', key: 'model', width: 190, ellipsis: { tooltip: true } },
  { title: '业务环节', key: 'stage', width: 160, render: r => stages[r.stage || ''] || r.stage || '未知' },
  { title: '状态', key: 'status', width: 80, render: r => statuses[r.status || 'unknown'] || r.status },
  { title: '消耗量', key: 'inputTokens', width: 250, render: r => logUsageTokens(r) },
  { title: '费用', key: 'costNanoUsd', width: 130, render: r => logUsageCost(r) },
  { title: '用量', key: 'usageStatus', width: 90, render: r => r.usageStatus === 'reported' ? '已上报' : '未知' },
  { title: '项目 ID', key: 'projectId', width: 200, ellipsis: { tooltip: true } },
  { title: '请求 ID', key: 'requestId', width: 220, ellipsis: { tooltip: true } },
  { title: '调用 ID', key: 'id', width: 220, ellipsis: { tooltip: true } }
]

async function load() {
  const current = ++request
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ data: AdminUsageData }>('/api/admin/model-usage', { query: { ...applied.value, page: page.value, pageSize: 50 } })
    if (current === request) data.value = response.data
  } catch {
    if (current === request) error.value = '用量加载失败，请检查日期范围、登录权限或网络后重试。'
  } finally {
    if (current === request) loading.value = false
  }
}
function search() { applied.value = { ...filters }; page.value = 1; void load() }
function reset() { Object.assign(filters, defaults()); search() }
function changePage(value: number) { page.value = value; void load() }
onMounted(load)
</script>

<style scoped>
.usage-page { display: grid; gap: 20px; }
.usage-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h1 { margin: 0; font-size: 24px; }
h2 { margin: 0 0 12px; font-size: 16px; }
h2 small { font-weight: 400; font-size: 12px; color: #767c85; }
.usage-header p { margin: 6px 0 0; }
.usage-filters { display: grid; grid-template-columns: repeat(3, minmax(160px, 1fr)); gap: 12px; }
.usage-filters label { display: grid; gap: 6px; font-size: 13px; }
.usage-filters input[type=date] { min-width: 0; height: 34px; box-sizing: border-box; padding: 0 10px; border: 1px solid #e0e0e6; border-radius: 3px; background: white; font: inherit; }
.usage-filters select { min-width: 0; height: 34px; padding: 0 10px; border: 1px solid #e0e0e6; border-radius: 3px; background: white; color: inherit; font: inherit; }
.usage-actions { display: flex; align-items: end; gap: 8px; }
.usage-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid #e5e7eb; border-radius: 6px; }
.usage-metrics > div { display: grid; gap: 6px; padding: 18px; }
.usage-metrics strong { font-size: 24px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.usage-metrics span, .usage-metrics small { color: #767c85; }
.usage-rankings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
section { min-width: 0; }
@media (max-width: 1100px) { .usage-rankings { grid-template-columns: 1fr; } .usage-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) { .usage-filters { grid-template-columns: 1fr; } .usage-metrics { grid-template-columns: 1fr; } }
</style>
