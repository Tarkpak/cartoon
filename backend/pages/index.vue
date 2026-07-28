<template>
  <AdminShell>
    <div class="page">
      <n-grid :cols="4" :x-gap="16">
        <n-gi>
          <n-card>
            <n-statistic label="用户数" :value="userTotal" />
          </n-card>
        </n-gi>
        <n-gi>
          <n-card>
            <n-statistic label="近期调用日志" :value="logTotal" />
          </n-card>
        </n-gi>
        <n-gi>
          <n-card><n-statistic label="积分总余额" :value="creditSummary.total_balance" /></n-card>
        </n-gi>
        <n-gi>
          <n-card><n-statistic label="本月积分消耗" :value="creditSummary.month_consumed" /></n-card>
        </n-gi>
      </n-grid>

      <n-card title="本月 Seedance 消耗" style="margin-top: 16px">
        <n-data-table
          v-if="creditSummary.month_breakdown.length > 0"
          :columns="creditBreakdownColumns"
          :data="creditSummary.month_breakdown"
          :bordered="false"
          :pagination="false"
        />
        <n-empty v-else description="本月暂无 Seedance 动态计费记录" style="padding: 24px 0" />
      </n-card>

      <n-card title="实施边界" style="margin-top: 16px">
        <n-space vertical>
          <n-alert type="info">模型调用在客户端执行，后台负责登录、设备、Key 下发、项目同步和日志查看。</n-alert>
          <n-alert type="warning">后台只保存生成媒体的 CDN URL 或对象存储 key，不保存图片、视频、音频二进制。</n-alert>
        </n-space>
      </n-card>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
interface CreditBreakdownRow {
  model_id: string
  variant: string
  resolution: string
  rate_per_second: number
  call_count: number
  duration_seconds: number
  credits_consumed: number
}

interface CreditSummary {
  total_balance: number
  month_consumed: number
  month_breakdown: CreditBreakdownRow[]
}

const users = await useFetch<{ data: { pagination: { total: number } } }>('/api/admin/users', { server: false })
const logs = await useFetch<{ data: { pagination: { total: number } } }>('/api/admin/model-call-logs', { server: false })
const credits = await useFetch<{ data: CreditSummary }>('/api/admin/credits/summary', { server: false })

const userTotal = computed(() => users.data.value?.data.pagination.total || 0)
const logTotal = computed(() => logs.data.value?.data.pagination.total || 0)
const creditSummary = computed<CreditSummary>(() => credits.data.value?.data || {
  total_balance: 0,
  month_consumed: 0,
  month_breakdown: []
})

const variantLabels: Record<string, string> = {
  standard: 'Seedance 2.0',
  fast: 'Seedance 2.0 Fast',
  mini: 'Seedance 2.0 Mini'
}

const creditBreakdownColumns = [
  { title: '模型', key: 'variant', render: (row: CreditBreakdownRow) => variantLabels[row.variant] || row.model_id },
  { title: '分辨率', key: 'resolution', width: 100 },
  { title: '费率（积分/秒）', key: 'rate_per_second', width: 150 },
  { title: '调用次数', key: 'call_count', width: 100 },
  { title: '输出时长（秒）', key: 'duration_seconds', width: 130 },
  { title: '消耗积分', key: 'credits_consumed', width: 110 }
]
</script>
