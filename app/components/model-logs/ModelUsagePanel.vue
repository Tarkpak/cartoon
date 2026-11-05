<script setup lang="ts">
import { logUsageCost, logUsageTokens } from '#shared/utils/model-usage-display'
import { usageTotalsCost, usageTokens, type UsageData } from '@/lib/model-usage'

const props = defineProps<{ requestId?: string, logId?: string, compact?: boolean }>()
const data = ref<UsageData | null>(null)
const loading = ref(false)
const error = ref('')
let sequence = 0
async function refresh() {
  const seq = ++sequence
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ data: UsageData }>('/api/model-usage', {
      query: { requestId: props.requestId || undefined, id: props.logId || undefined }
    })
    if (seq === sequence) data.value = response.data
  } catch {
    if (seq === sequence) { data.value = null; error.value = '用量读取失败，请重试' }
  } finally { if (seq === sequence) loading.value = false }
}
watch(() => [props.requestId, props.logId], () => { data.value = null; void refresh() }, { immediate: true })
onBeforeUnmount(() => { sequence++ })
const periods = computed(() => data.value ? [
  { label: '今日', value: data.value.today }, { label: '本月', value: data.value.month }
] : [])
</script>

<template>
  <section class="space-y-3" aria-label="用量与费用">
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm font-medium">{{ compact ? '本次调用用量' : '用量与费用' }}</p>
      <Button variant="ghost" size="sm" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '刷新' }}</Button>
    </div>
    <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
    <template v-if="data">
      <p v-if="compact" class="text-xs tabular-nums text-muted-foreground">
        <template v-if="data.total.calls">
          {{ data.total.calls }} 次调用 · 已记录 {{ usageTokens(data.total.inputTokens + data.total.outputTokens) }} tokens ·
          预估 {{ usageTotalsCost(data.total) }}
          <span v-if="data.total.unknownCalls"> · {{ data.total.unknownCalls }} 次用量未知</span>
          <span v-if="data.total.pricedCalls < data.total.calls"> · {{ data.total.calls - data.total.pricedCalls }} 次未估价</span>
        </template>
        <template v-else>未采集到用量记录</template>
      </p>
      <template v-else>
        <div class="grid gap-3 sm:grid-cols-2">
          <div v-for="period in periods" :key="period.label" class="rounded-lg border p-4">
            <p class="text-xs text-muted-foreground">{{ period.label }}预估费用（原币种）</p>
            <p class="mt-2 text-2xl font-semibold tabular-nums">{{ usageTotalsCost(period.value) }}</p>
            <p class="mt-2 text-xs tabular-nums text-muted-foreground">{{ period.value.calls }} 次调用 · 输入 {{ usageTokens(period.value.inputTokens) }} / 输出 {{ usageTokens(period.value.outputTokens) }}</p>
            <p class="mt-1 text-xs text-muted-foreground">已估价 {{ period.value.pricedCalls }}/{{ period.value.calls }} 次 · 用量未知 {{ period.value.unknownCalls }} 次</p>
          </div>
        </div>
        <p class="text-xs text-muted-foreground">统计当前账号在本应用采集的 OpenAI / 兼容接口、通义、DeepSeek 及火山 Seedance 调用，日期按北京时间。费用为已估价部分，不含平台积分，以供应商账单为准。</p>
      </template>
      <div v-if="data.records.length" class="overflow-x-auto rounded-lg border">
        <table class="w-full text-left text-xs">
          <thead class="bg-muted/40 text-muted-foreground"><tr>
            <th class="p-3 font-medium">模型 / 状态</th><th class="p-3 font-medium">消耗量</th><th class="p-3 font-medium">缓存 / 推理</th><th class="p-3 font-medium">预估费用</th>
          </tr></thead>
          <tbody>
            <tr v-for="record in data.records" :key="record.id" class="border-t align-top">
              <td class="p-3"><span class="block font-medium">{{ record.model }}</span><span class="text-muted-foreground">{{ record.provider }} · {{ record.status === 'success' ? '成功' : record.status === 'unknown' ? '未确认完成' : '失败' }}</span><time class="mt-1 block text-muted-foreground">{{ new Date(record.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}</time></td>
              <td class="p-3 tabular-nums">{{ logUsageTokens(record.usage) }}<span v-if="record.usage.imageInputTokens != null" class="mt-1 block text-muted-foreground">文字 {{ usageTokens(record.usage.textInputTokens) }} · 图片 {{ usageTokens(record.usage.imageInputTokens) }}</span></td>
              <td class="p-3 tabular-nums">{{ usageTokens(record.usage.cachedTokens) }} / {{ usageTokens(record.usage.reasoningTokens) }}</td>
              <td class="p-3 tabular-nums">{{ logUsageCost(record.usage) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else-if="!compact" class="py-10 text-center text-sm text-muted-foreground">暂无用量记录。完成一次已接入统计的模型调用后即可查看。</p>
      <p v-if="data.records.some(r => r.provider === 'deepseek')" class="text-xs text-muted-foreground">DeepSeek 按中文官网人民币高峰参考价估算，未扣除低峰及节假日折扣；通义按北京地域公开原价估算，不含活动优惠。</p>
      <p v-if="data.total.calls > data.records.length" class="text-xs text-muted-foreground">展示最近 {{ data.records.length }} 条；汇总包含全部匹配调用。清理调用日志不会删除用量台账。</p>
    </template>
  </section>
</template>
