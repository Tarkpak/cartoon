<template>
  <AdminShell content-mode="fixed">
    <div class="page library-admin fixed-table-page">
      <header class="library-admin__header">
        <div><h1>资源库管理</h1><p class="muted">审计资源归属、共享状态、授权到期和删除记录。</p></div>
        <n-button :loading="pending" @click="load">刷新</n-button>
      </header>

      <div class="library-admin__summary">
        <div><strong>{{ summary.total }}</strong><span>全部记录</span></div>
        <div><strong>{{ summary.images }}</strong><span>图片</span></div>
        <div><strong>{{ summary.audio }}</strong><span>音频</span></div>
        <div><strong>{{ summary.shared }}</strong><span>共享中</span></div>
        <div><strong>{{ summary.expiring }}</strong><span>授权预警</span></div>
      </div>

      <div class="library-admin__toolbar">
        <n-input v-model:value="keyword" clearable placeholder="搜索名称、成员或描述" @keyup.enter="load" />
        <n-select v-model:value="category" clearable placeholder="全部分类" :options="categoryOptions" />
        <n-select v-model:value="status" :options="statusOptions" />
        <n-button type="primary" @click="load">查询</n-button>
      </div>

      <n-alert v-if="errorMessage" type="error">{{ errorMessage }}</n-alert>
      <n-data-table class="fixed-data-table" :columns="columns" :data="assets" :loading="pending" :pagination="pagination" :row-key="rowKey" flex-height @update:page="handlePageUpdate" />

      <n-modal v-model:show="previewOpen" preset="card" class="library-admin__preview" :title="previewAsset?.name">
        <img v-if="previewAsset?.mediaType === 'image'" :src="previewAsset.url" :alt="previewAsset.name">
        <audio v-else-if="previewAsset" :src="previewAsset.url" controls autoplay />
      </n-modal>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NButton, NTag, NSpace, useMessage, type DataTableColumns } from 'naive-ui'
import { mediaTypeLabel } from '@playlet-shared/utils/display-labels'

interface AdminLibraryAsset {
  id: string
  cloudId: string
  ownerAccount: string
  ownerDisplayName: string
  mediaType: 'image' | 'audio'
  category: string
  name: string
  url: string
  visibility: string
  useCount: number
  licenseExpiresAt?: string
  deletedAt?: string
  updatedAt: string
  shares: unknown[]
}

const message = useMessage()
const assets = ref<AdminLibraryAsset[]>([])
const pending = ref(false)
const errorMessage = ref('')
const keyword = ref('')
const category = ref<string | null>(null)
const status = ref('active')
const summary = reactive({ total: 0, images: 0, audio: 0, shared: 0, expiring: 0 })
const pagination = reactive({ page: 1, pageSize: 30, itemCount: 0 })
const previewOpen = ref(false)
const previewAsset = ref<AdminLibraryAsset | null>(null)

const categoryOptions = [
  ['character', '角色图'], ['environment', '场景图'], ['prop', '道具图'], ['style', '画风参考'],
  ['character_voice', '角色音色'], ['narration', '旁白'], ['bgm', 'BGM'], ['sfx', '音效'], ['other', '其他']
].map(([value, label]) => ({ value, label }))
const categoryLabels = Object.fromEntries(categoryOptions.map(item => [item.value, item.label]))
const statusOptions = [
  { value: 'active', label: '使用中' },
  { value: 'expiring', label: '授权预警' },
  { value: 'deleted', label: '已删除' }
]

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-'
}

function rowKey(row: AdminLibraryAsset) {
  return row.cloudId
}

function handlePageUpdate(page: number) {
  pagination.page = page
  void load()
}

async function changeStatus(asset: AdminLibraryAsset, action: 'delete' | 'restore') {
  await $fetch(`/api/admin/library-assets/${asset.cloudId}`, { method: 'PATCH', body: { action } })
  message.success(action === 'delete' ? '资源已软删除' : '资源已恢复')
  await load()
}

const columns: DataTableColumns<AdminLibraryAsset> = [
  { title: '名称', key: 'name', minWidth: 180, ellipsis: { tooltip: true } },
  { title: '所有者', key: 'owner', width: 150, render: row => h('div', [h('strong', row.ownerDisplayName || row.ownerAccount), h('div', { class: 'muted' }, row.ownerAccount)]) },
  { title: '类型', key: 'type', width: 120, render: row => h(NSpace, { size: 4 }, { default: () => [h(NTag, { size: 'small' }, { default: () => mediaTypeLabel(row.mediaType) }), h(NTag, { size: 'small', bordered: false }, { default: () => categoryLabels[row.category] || row.category })] }) },
  { title: '共享', key: 'visibility', width: 90, render: row => row.visibility === 'shared' ? `${row.shares.length} 人` : '私有' },
  { title: '使用次数', key: 'useCount', width: 90 },
  { title: '授权到期', key: 'licenseExpiresAt', width: 120, render: row => formatDate(row.licenseExpiresAt).split(' ')[0] },
  { title: '更新时间', key: 'updatedAt', width: 170, render: row => formatDate(row.updatedAt) },
  { title: '操作', key: 'actions', width: 150, fixed: 'right', render: row => h(NSpace, { size: 6 }, { default: () => [
    h(NButton, { size: 'small', onClick: () => { previewAsset.value = row; previewOpen.value = true } }, { default: () => '预览' }),
    h(NButton, { size: 'small', type: row.deletedAt ? 'primary' : 'error', secondary: true, onClick: () => changeStatus(row, row.deletedAt ? 'restore' : 'delete') }, { default: () => row.deletedAt ? '恢复' : '删除' })
  ] }) }
]

async function load() {
  pending.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<any>('/api/admin/library-assets', { query: { page: pagination.page, pageSize: pagination.pageSize, keyword: keyword.value, category: category.value || undefined, status: status.value } })
    assets.value = response.data.assets
    Object.assign(summary, response.data.summary)
    pagination.itemCount = response.data.pagination.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载失败'
  } finally {
    pending.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.library-admin { display: flex; height: 100%; min-height: 0; flex-direction: column; gap: 14px; padding: 20px; }
.library-admin__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.library-admin__header h1 { margin: 0; font-size: 22px; }
.library-admin__header p { margin: 4px 0 0; }
.library-admin__summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.library-admin__summary > div { display: flex; align-items: baseline; gap: 8px; border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; }
.library-admin__summary strong { font-size: 20px; }
.library-admin__summary span { color: var(--text-color-3); font-size: 12px; }
.library-admin__toolbar { display: grid; grid-template-columns: minmax(240px, 1fr) 180px 150px auto; gap: 10px; }
.library-admin__preview { width: min(900px, 90vw); }
.library-admin__preview img { display: block; max-height: 72vh; width: 100%; object-fit: contain; }
.library-admin__preview audio { width: 100%; }
@media (max-width: 900px) { .library-admin__summary { grid-template-columns: repeat(2, 1fr); } .library-admin__toolbar { grid-template-columns: 1fr 1fr; } }
</style>
