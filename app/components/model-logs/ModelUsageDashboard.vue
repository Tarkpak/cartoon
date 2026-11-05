<script setup lang="ts">
import { logUsageCost, logUsageTokens } from '#shared/utils/model-usage-display'
import { Download, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { observedFetch } from '@/lib/observability'
import { usageCost, usageTokens, usageStage, usageProvider, usageModelGroup, type UsageData, type UsageFilters, type UsageGroup, type UsageTotals } from '@/lib/model-usage'

const props = defineProps<{ projectId?: string }>()
const data = ref<UsageData | null>(null)
const filters = reactive<UsageFilters>({ currency: 'USD', startDate: '', endDate: '', projectId: props.projectId || '', providerInstanceId: '', model: '', stage: '' })
const page = ref(1)
const loading = ref(false)
const exporting = ref(false)
const error = ref('')
let sequence = 0
const query = computed(() => ({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page: page.value, pageSize: 50 }))
async function refresh() {
  const seq = ++sequence
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ data: UsageData }>('/api/model-usage', { query: query.value })
    if (seq === sequence) data.value = response.data
  } catch (cause) {
    if (seq === sequence) {
      data.value = null
      error.value = (cause as { data?: { message?: string } }).data?.message || '用量读取失败，请重试'
    }
  } finally { if (seq === sequence) loading.value = false }
}
watch(filters, () => { if (page.value === 1) void refresh(); else page.value = 1 })
watch(page, () => { void refresh() })
watch(() => props.projectId, value => { filters.projectId = value || '' })
onMounted(() => { void refresh() })
onBeforeUnmount(() => { sequence++ })
function clearFilters() { Object.assign(filters, { startDate: '', endDate: '', projectId: '', providerInstanceId: '', model: '', stage: '' }) }
async function exportCsv() {
  exporting.value = true
  error.value = ''
  try {
    const params = new URLSearchParams(Object.entries(query.value).map(([key, value]) => [key, String(value)]))
    const response = await observedFetch(`/api/model-usage/export?${params}`)
    if (!response.ok) throw new Error('导出失败')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `model-usage-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch { error.value = '导出失败，请重试' } finally { exporting.value = false }
}
const periods = computed(() => data.value ? [
  { label: '筛选范围', value: data.value.total }, { label: '今日（筛选内）', value: data.value.today }, { label: '本月（筛选内）', value: data.value.month }
] : [])
const breakdowns = computed(() => data.value ? [
  { title: '项目费用分布', key: 'projectId' as const, items: data.value.projects },
  { title: '业务环节费用分布', key: 'stage' as const, items: data.value.stages }
] : [])
const models = computed(() => (data.value?.models || []).map(item => ({ ...item, ...usageModelGroup(item.key) })))
function amount(group: UsageTotals) { return filters.currency === 'CNY' ? group.costNanoCny || 0 : group.costNanoUsd }
function cost(value: number | null) { return usageCost(value, filters.currency) }
function percent(group: UsageGroup) { return data.value && amount(data.value.total) ? amount(group) / amount(data.value.total) * 100 : 0 }
function providerName(id: string) { return usageProvider(id, data.value?.options.providers) }
function projectName(id?: string) { return data.value?.options.projects.find(item => item.key === id)?.label || id || '未关联项目' }
</script>

<template>
  <section class="space-y-4 pb-4" aria-label="用量与费用分析">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm font-medium">用量与费用</p>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" :disabled="loading || exporting || !data?.total.calls" @click="exportCsv"><Download class="size-4" />{{ exporting ? '导出中…' : '导出筛选明细 CSV' }}</Button>
        <Button variant="outline" size="sm" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '刷新' }}</Button>
      </div>
    </div>
    <div class="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 xl:grid-cols-6">
      <label class="space-y-1 text-xs">币种<select v-model="filters.currency" class="h-9 w-full rounded-md border bg-background px-2"><option value="USD">美元 USD</option><option value="CNY">人民币 CNY</option></select></label>
      <label class="space-y-1 text-xs">开始日期<Input v-model="filters.startDate" type="date" /></label>
      <label class="space-y-1 text-xs">结束日期<Input v-model="filters.endDate" type="date" /></label>
      <label class="space-y-1 text-xs">项目<select v-model="filters.projectId" class="h-9 w-full rounded-md border bg-background px-2"><option value="">全部项目</option><option v-for="item in data?.options.projects || []" :key="item.key" :value="item.key">{{ item.label }}</option><option v-if="filters.projectId && !data?.options.projects.some(item => item.key === filters.projectId)" :value="filters.projectId">{{ filters.projectId }}</option></select></label>
      <label class="space-y-1 text-xs">供应商实例<select v-model="filters.providerInstanceId" class="h-9 w-full rounded-md border bg-background px-2"><option value="">全部供应商</option><option v-for="item in data?.options.providers || []" :key="item.key" :value="item.key">{{ providerName(item.key) }}</option></select></label>
      <label class="space-y-1 text-xs">模型<select v-model="filters.model" class="h-9 w-full rounded-md border bg-background px-2"><option value="">全部模型</option><option v-for="item in data?.options.models || []" :key="item.key" :value="item.key">{{ item.label }}</option></select></label>
      <label class="space-y-1 text-xs">业务环节<select v-model="filters.stage" class="h-9 w-full rounded-md border bg-background px-2"><option value="">全部环节</option><option v-for="item in data?.options.stages || []" :key="item.key" :value="item.key">{{ usageStage(item.key) }}</option></select></label>
      <Button variant="ghost" size="sm" class="justify-self-start" @click="clearFilters">清除筛选</Button>
    </div>
    <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
    <div v-if="data" :aria-busy="loading" class="space-y-4">
      <div class="grid gap-3 md:grid-cols-3">
        <div v-for="period in periods" :key="period.label" class="rounded-lg border p-4">
          <p class="text-xs text-muted-foreground">{{ period.label }}预估费用 · {{ filters.currency }}</p>
          <p class="mt-2 text-2xl font-semibold tabular-nums">{{ cost(period.value.calls === 0 || period.value.pricedCalls ? amount(period.value) : null) }}</p>
          <p class="mt-2 text-xs tabular-nums text-muted-foreground">{{ period.value.calls }} 次调用 · 输入 {{ usageTokens(period.value.inputTokens) }} / 输出 {{ usageTokens(period.value.outputTokens) }}</p>
          <p class="mt-1 text-xs text-muted-foreground">已估价 {{ period.value.pricedCalls }}/{{ period.value.calls }} 次 · 用量未知 {{ period.value.unknownCalls }} 次</p>
        </div>
      </div>
      <p class="text-xs text-muted-foreground">当前账号、本应用采集的调用；日期按北京时间，结束日期含当天。美元与人民币分开统计，不做换算。费用仅合计已估价调用，不含平台积分。价格更改不会重算历史记录。</p>
      <p class="text-xs text-muted-foreground">DeepSeek 按官方高峰参考价估算，未扣除低峰及节假日折扣；通义按北京地域公开原价估算，不含活动优惠。缺少价格或计费信息时显示未估价。</p>
      <div v-if="data.total.calls" class="grid gap-3 lg:grid-cols-2">
        <section v-for="group in breakdowns" :key="group.key" class="rounded-lg border p-4">
          <h3 class="mb-3 text-sm font-medium">{{ group.title }}</h3>
          <ul class="max-h-64 space-y-3 overflow-y-auto">
            <li v-for="item in group.items" :key="item.key">
              <button class="w-full space-y-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="filters[group.key] = item.key">
                <span class="flex justify-between gap-3"><span class="truncate">{{ group.key === 'stage' ? usageStage(item.key) : item.label }}</span><span class="shrink-0 tabular-nums">{{ cost(item.pricedCalls ? amount(item) : null) }} · {{ percent(item).toFixed(1) }}%</span></span>
                <span class="block h-1.5 overflow-hidden rounded bg-muted"><span class="block h-full rounded bg-primary" :style="{ width: `${percent(item)}%` }" /></span>
                <span class="block text-muted-foreground">{{ item.calls }} 次调用 · 已估价 {{ item.pricedCalls }} 次 · 用量未知 {{ item.unknownCalls }} 次</span>
              </button>
            </li>
          </ul>
        </section>
      </div>
      <section v-if="models.length" class="space-y-2">
        <h3 class="text-sm font-medium">模型成本对比</h3>
        <p class="text-xs text-muted-foreground">均价只按已估价调用计算；不同环节和输入规模影响成本，此处不代表模型质量或同任务报价。</p>
        <div class="max-h-80 overflow-auto rounded-lg border">
          <table class="w-full text-left text-xs"><thead class="bg-muted/40 text-muted-foreground"><tr><th class="p-3 font-medium">供应商 / 模型 / 环节</th><th class="p-3 font-medium">调用 / 已估价</th><th class="p-3 font-medium">输入 / 输出 tokens</th><th class="p-3 font-medium">合计 {{ filters.currency }}</th><th class="p-3 font-medium">单次均价 {{ filters.currency }}</th></tr></thead>
            <tbody><tr v-for="item in models" :key="item.key" class="border-t"><td class="p-3"><span class="block font-medium">{{ item.model }}</span><span class="text-muted-foreground">{{ providerName(item.instanceId) }} · {{ usageStage(item.stage) }}</span></td><td class="p-3 tabular-nums">{{ item.calls }} / {{ item.pricedCalls }}</td><td class="p-3 tabular-nums">{{ usageTokens(item.inputTokens) }} / {{ usageTokens(item.outputTokens) }}</td><td class="p-3 tabular-nums">{{ cost(item.pricedCalls ? amount(item) : null) }}</td><td class="p-3 tabular-nums">{{ cost((filters.currency === 'CNY' ? item.averageCostNanoCny : item.averageCostNanoUsd) ?? null) }}</td></tr></tbody>
          </table>
        </div>
      </section>
      <section class="space-y-2">
        <h3 class="text-sm font-medium">调用明细</h3>
        <div v-if="data.records.length" class="overflow-x-auto rounded-lg border">
          <table class="w-full text-left text-xs"><thead class="bg-muted/40 text-muted-foreground"><tr><th class="p-3 font-medium">时间 / 模型 / 项目</th><th class="p-3 font-medium">输入 / 输出</th><th class="p-3 font-medium">缓存 / 推理</th><th class="p-3 font-medium">预估费用 / 价格版本</th></tr></thead>
            <tbody><tr v-for="record in data.records" :key="record.id" class="border-t align-top">
              <td class="p-3"><time class="text-muted-foreground">{{ new Date(record.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}</time><span class="mt-1 block font-medium">{{ record.usage.model || record.model }}</span><span class="block text-muted-foreground">{{ record.providerInstanceName || providerName(record.providerInstanceId || `${record.provider}:legacy`) }} · {{ projectName(record.projectId) }}</span><span class="text-muted-foreground">{{ usageStage(record.stage || record.operation) }} · {{ record.status === 'success' ? '成功' : record.status === 'unknown' ? '未确认完成' : '失败' }}</span></td>
              <td class="p-3 tabular-nums">{{ logUsageTokens(record.usage) }}<span v-if="record.usage.imageInputTokens != null" class="mt-1 block text-muted-foreground">文字 {{ usageTokens(record.usage.textInputTokens) }} · 图片 {{ usageTokens(record.usage.imageInputTokens) }}</span></td>
              <td class="p-3 tabular-nums">{{ usageTokens(record.usage.cachedTokens) }} / {{ usageTokens(record.usage.reasoningTokens) }}</td>
              <td class="p-3 tabular-nums">{{ logUsageCost(record.usage) }}<span class="mt-1 block max-w-56 break-all text-muted-foreground">{{ record.usage.priceSnapshot?.version || '无可用价格版本' }}</span></td>
            </tr></tbody>
          </table>
        </div>
        <p v-else class="py-8 text-center text-sm text-muted-foreground">此筛选范围内暂无用量记录。</p>
        <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>共 {{ data.total.calls }} 条 · 第 {{ data.page }}/{{ data.totalPages }} 页 · 汇总及导出包含全部匹配记录</span><div class="flex gap-1"><Button variant="outline" size="sm" :disabled="loading || page <= 1" @click="page--"><ChevronLeft class="size-4" />上一页</Button><Button variant="outline" size="sm" :disabled="loading || page >= data.totalPages" @click="page++">下一页<ChevronRight class="size-4" /></Button></div></div>
      </section>
    </div>
  </section>
</template>
