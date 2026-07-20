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
const users = await useFetch<{ data: { pagination: { total: number } } }>('/api/admin/users', { server: false })
const logs = await useFetch<{ data: { pagination: { total: number } } }>('/api/admin/model-call-logs', { server: false })
const credits = await useFetch<{ data: { total_balance: number, month_consumed: number } }>('/api/admin/credits/summary', { server: false })

const userTotal = computed(() => users.data.value?.data.pagination.total || 0)
const logTotal = computed(() => logs.data.value?.data.pagination.total || 0)
const creditSummary = computed(() => credits.data.value?.data || { total_balance: 0, month_consumed: 0 })
</script>
