<template>
  <AdminShell>
    <div class="page">
      <n-space vertical class="table-section">
        <n-input v-model:value="keyword" placeholder="搜索 request id、错误、用户" clearable @keyup.enter="loadLogs" />
        <n-data-table :columns="columns" :data="logs" :loading="pending" />
      </n-space>

      <n-drawer v-model:show="drawer" width="760">
        <n-drawer-content title="日志详情">
          <pre class="json-view">{{ selectedLogJson }}</pre>
        </n-drawer-content>
      </n-drawer>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NButton, NTag } from 'naive-ui'

const keyword = ref('')
const pending = ref(false)
const logs = ref<any[]>([])
const drawer = ref(false)
const selectedLogJson = ref('')

const columns = [
  { title: '时间', key: 'created_at' },
  { title: '用户', key: 'account' },
  { title: '供应商', key: 'provider' },
  { title: '模型', key: 'model_id' },
  { title: '操作', key: 'operation' },
  {
    title: '状态',
    key: 'status',
    render(row: any) {
      return h(NTag, { size: 'small', type: row.status === 'success' ? 'success' : row.status === 'failed' ? 'error' : 'info' }, { default: () => row.status })
    }
  },
  { title: '耗时 ms', key: 'duration_ms' },
  {
    title: '操作',
    key: 'actions',
    render(row: any) {
      return h(NButton, { size: 'small', onClick: () => openLog(row.id) }, { default: () => '详情' })
    }
  }
]

async function loadLogs() {
  pending.value = true
  try {
    const response = await $fetch<any>('/api/admin/model-call-logs', {
      query: { keyword: keyword.value }
    })
    logs.value = response.data.logs
  } finally {
    pending.value = false
  }
}

async function openLog(id: string) {
  const response = await $fetch<any>(`/api/admin/model-call-logs/${id}`)
  selectedLogJson.value = JSON.stringify(response.data.log, null, 2)
  drawer.value = true
}

onMounted(loadLogs)
</script>

<style scoped>
.json-view {
  max-height: 80vh;
  overflow: auto;
  padding: 12px;
  border-radius: 6px;
  background: #101828;
  color: #f2f4f7;
  font-size: 12px;
}
</style>
