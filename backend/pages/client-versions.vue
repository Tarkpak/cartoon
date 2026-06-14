<template>
  <AdminShell>
    <div class="page client-versions-page">
      <div class="page-header page-header--actions">
        <n-space>
          <n-button :loading="pending" @click="loadVersions">刷新</n-button>
          <n-button type="primary" @click="openCreate">新建版本</n-button>
        </n-space>
      </div>

      <n-space vertical :size="10" class="table-section">
        <div class="client-versions-filters">
          <n-input
            v-model:value="filters.keyword"
            clearable
            placeholder="搜索版本、下载地址或说明"
            @keyup.enter="applyFilters"
          />
          <n-select
            v-model:value="filters.platform"
            clearable
            placeholder="平台"
            :options="platformFilterOptions"
            @update:value="applyFilters"
          />
          <n-select
            v-model:value="filters.arch"
            clearable
            placeholder="架构"
            :options="archFilterOptions"
            @update:value="applyFilters"
          />
          <n-select
            v-model:value="filters.channel"
            clearable
            placeholder="渠道"
            :options="channelFilterOptions"
            @update:value="applyFilters"
          />
          <n-select
            v-model:value="filters.status"
            clearable
            placeholder="状态"
            :options="statusFilterOptions"
            @update:value="applyFilters"
          />
          <n-button :loading="pending" @click="applyFilters">查询</n-button>
        </div>

        <n-data-table
          :columns="columns"
          :data="versions"
          :loading="pending"
          :row-key="rowKey"
          :scroll-x="1320"
          size="small"
        />

        <div class="client-versions-pagination">
          <n-space align="center" justify="end" size="small">
            <span class="muted">共 {{ pagination.total }} 条，第 {{ pagination.page }} 页</span>
            <n-button size="small" :disabled="pagination.page <= 1 || pending" @click="changePage(pagination.page - 1)">
              上一页
            </n-button>
            <n-button size="small" :disabled="!hasNextPage || pending" @click="changePage(pagination.page + 1)">
              下一页
            </n-button>
          </n-space>
        </div>

        <section class="device-version-section">
          <div class="device-version-section__header">
            <span>设备版本分布</span>
            <n-tag size="small">{{ deviceVersions.length }}</n-tag>
          </div>
          <n-data-table
            :columns="deviceColumns"
            :data="deviceVersions"
            :loading="pending"
            :row-key="deviceRowKey"
            size="small"
          />
        </section>
      </n-space>

      <n-modal
        v-model:show="showModal"
        preset="card"
        :title="modalTitle"
        style="width: min(760px, calc(100vw - 32px))"
      >
        <n-form label-placement="top">
          <div class="client-version-form-grid">
            <n-form-item label="App Key">
              <n-input v-model:value="form.appKey" placeholder="cartoon-desktop" />
            </n-form-item>
            <n-form-item label="版本号">
              <n-input v-model:value="form.version" placeholder="1.2.0" />
            </n-form-item>
            <n-form-item label="平台">
              <n-select v-model:value="form.platform" :options="platformOptions" />
            </n-form-item>
            <n-form-item label="架构">
              <n-select v-model:value="form.arch" :options="archOptions" />
            </n-form-item>
            <n-form-item label="渠道">
              <n-select v-model:value="form.channel" :options="channelOptions" />
            </n-form-item>
            <n-form-item label="状态">
              <n-select v-model:value="form.status" :options="statusOptions" />
            </n-form-item>
            <n-form-item label="构建号">
              <n-input-number v-model:value="form.buildNumber" :min="0" class="client-version-number" />
            </n-form-item>
            <n-form-item label="灰度比例">
              <n-input-number v-model:value="form.rolloutPercent" :min="0" :max="100" class="client-version-number" />
            </n-form-item>
          </div>

          <n-form-item label="下载地址">
            <n-input v-model:value="form.downloadUrl" placeholder="https://..." />
          </n-form-item>

          <div class="client-version-form-grid">
            <n-form-item label="SHA256">
              <n-input v-model:value="form.sha256" />
            </n-form-item>
            <n-form-item label="最低可用版本">
              <n-input v-model:value="form.minSupportedVersion" placeholder="低于该版本会强制更新" />
            </n-form-item>
          </div>

          <n-form-item label="签名">
            <n-input v-model:value="form.signature" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" />
          </n-form-item>
          <n-form-item label="更新说明">
            <n-input v-model:value="form.releaseNotes" type="textarea" :autosize="{ minRows: 4, maxRows: 8 }" />
          </n-form-item>
          <n-form-item label="强制更新">
            <n-switch v-model:value="form.forceUpdate" />
          </n-form-item>

          <n-space justify="end">
            <n-button @click="showModal = false">取消</n-button>
            <n-button type="primary" :loading="saving" @click="saveVersion">保存</n-button>
          </n-space>
        </n-form>
      </n-modal>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NButton, NEllipsis, NSpace, NTag, useMessage } from 'naive-ui'

interface ClientVersionRow {
  id: string
  appKey: string
  platform: string
  arch: string
  channel: string
  version: string
  buildNumber: number
  status: 'draft' | 'published' | 'disabled'
  downloadUrl: string
  sha256: string
  signature: string
  releaseNotes: string
  forceUpdate: boolean
  minSupportedVersion: string
  rolloutPercent: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

interface DeviceVersionRow {
  version: string
  platform: string
  count: number
  lastSeenAt: string | null
}

const DEFAULT_FORM = {
  id: '',
  appKey: 'cartoon-desktop',
  platform: 'all',
  arch: 'all',
  channel: 'stable',
  version: '',
  buildNumber: 0,
  status: 'draft' as ClientVersionRow['status'],
  downloadUrl: '',
  sha256: '',
  signature: '',
  releaseNotes: '',
  forceUpdate: false,
  minSupportedVersion: '',
  rolloutPercent: 100
}

const platformOptions = [
  { label: '全部平台', value: 'all' },
  { label: 'macOS', value: 'macos' },
  { label: 'Windows', value: 'windows' },
  { label: 'Linux', value: 'linux' }
]
const archOptions = [
  { label: '全部架构', value: 'all' },
  { label: 'Apple Silicon / ARM64', value: 'aarch64' },
  { label: 'x86_64', value: 'x86_64' }
]
const channelOptions = [
  { label: 'stable', value: 'stable' },
  { label: 'beta', value: 'beta' },
  { label: 'alpha', value: 'alpha' }
]
const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已发布', value: 'published' },
  { label: '已禁用', value: 'disabled' }
]
const platformFilterOptions = platformOptions.filter(option => option.value !== 'all')
const archFilterOptions = archOptions.filter(option => option.value !== 'all')
const channelFilterOptions = channelOptions
const statusFilterOptions = statusOptions

const message = useMessage()
const pending = ref(false)
const saving = ref(false)
const showModal = ref(false)
const versions = ref<ClientVersionRow[]>([])
const deviceVersions = ref<DeviceVersionRow[]>([])
const form = reactive({ ...DEFAULT_FORM })
const filters = reactive({
  keyword: '',
  platform: null as string | null,
  arch: null as string | null,
  channel: null as string | null,
  status: null as string | null
})
const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const modalTitle = computed(() => form.id ? '编辑客户端版本' : '新建客户端版本')
const hasNextPage = computed(() => pagination.page * pagination.pageSize < pagination.total)

const columns = [
  {
    title: '版本',
    key: 'version',
    width: 130,
    fixed: 'left' as const,
    render(row: ClientVersionRow) {
      return h('span', { class: 'mono' }, row.version)
    }
  },
  {
    title: '目标',
    key: 'target',
    width: 210,
    render(row: ClientVersionRow) {
      return h(NSpace, { size: 4 }, {
        default: () => [
          h(NTag, { size: 'small' }, { default: () => row.platform }),
          h(NTag, { size: 'small' }, { default: () => row.arch }),
          h(NTag, { size: 'small', type: 'info' }, { default: () => row.channel })
        ]
      })
    }
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render(row: ClientVersionRow) {
      return h(NTag, { size: 'small', type: statusTagType(row.status) }, { default: () => statusLabel(row.status) })
    }
  },
  {
    title: '构建',
    key: 'buildNumber',
    width: 80
  },
  {
    title: '灰度',
    key: 'rolloutPercent',
    width: 80,
    render(row: ClientVersionRow) {
      return `${row.rolloutPercent}%`
    }
  },
  {
    title: '强制',
    key: 'forceUpdate',
    width: 80,
    render(row: ClientVersionRow) {
      return row.forceUpdate
        ? h(NTag, { size: 'small', type: 'warning' }, { default: () => '是' })
        : '-'
    }
  },
  {
    title: '最低版本',
    key: 'minSupportedVersion',
    width: 120,
    render(row: ClientVersionRow) {
      return row.minSupportedVersion || '-'
    }
  },
  {
    title: '下载地址',
    key: 'downloadUrl',
    minWidth: 260,
    ellipsis: { tooltip: true },
    render(row: ClientVersionRow) {
      return row.downloadUrl
        ? h(NEllipsis, { tooltip: true }, { default: () => row.downloadUrl })
        : '-'
    }
  },
  {
    title: '发布时间',
    key: 'publishedAt',
    width: 170,
    render(row: ClientVersionRow) {
      return formatAdminDateTime(row.publishedAt)
    }
  },
  {
    title: '更新时间',
    key: 'updatedAt',
    width: 170,
    render(row: ClientVersionRow) {
      return formatAdminDateTime(row.updatedAt)
    }
  },
  {
    title: '操作',
    key: 'actions',
    width: 210,
    fixed: 'right' as const,
    render(row: ClientVersionRow) {
      return h(NSpace, { size: 6 }, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(
            NButton,
            {
              size: 'small',
              type: row.status === 'published' ? 'warning' : 'primary',
              onClick: () => updateVersionStatus(row, row.status === 'published' ? 'disabled' : 'published')
            },
            { default: () => row.status === 'published' ? '禁用' : '发布' }
          )
        ]
      })
    }
  }
]

const deviceColumns = [
  { title: '版本', key: 'version' },
  { title: '平台', key: 'platform' },
  { title: '设备数', key: 'count', width: 120 },
  {
    title: '最近在线',
    key: 'lastSeenAt',
    width: 170,
    render(row: DeviceVersionRow) {
      return formatAdminDateTime(row.lastSeenAt)
    }
  }
]

function rowKey(row: ClientVersionRow) {
  return row.id
}

function deviceRowKey(row: DeviceVersionRow) {
  return `${row.platform}:${row.version}`
}

function statusLabel(status: ClientVersionRow['status']) {
  if (status === 'published') return '已发布'
  if (status === 'disabled') return '已禁用'
  return '草稿'
}

function statusTagType(status: ClientVersionRow['status']) {
  if (status === 'published') return 'success'
  if (status === 'disabled') return 'error'
  return 'default'
}

function errorText(error: unknown, fallback: string) {
  const data = (error as { data?: { statusMessage?: string, message?: string } })?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : fallback)
}

function queryParams() {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    keyword: filters.keyword || undefined,
    platform: filters.platform || undefined,
    arch: filters.arch || undefined,
    channel: filters.channel || undefined,
    status: filters.status || undefined
  }
}

async function loadVersions() {
  pending.value = true
  try {
    const response = await $fetch<{
      data: {
        versions: ClientVersionRow[]
        deviceVersions: DeviceVersionRow[]
        pagination: { page: number, pageSize: number, total: number }
      }
    }>('/api/admin/client-versions', {
      query: queryParams()
    })
    versions.value = response.data.versions
    deviceVersions.value = response.data.deviceVersions
    Object.assign(pagination, response.data.pagination)
  } catch (error) {
    message.error(errorText(error, '加载客户端版本失败'))
  } finally {
    pending.value = false
  }
}

function applyFilters() {
  pagination.page = 1
  void loadVersions()
}

function changePage(page: number) {
  pagination.page = page
  void loadVersions()
}

function resetForm() {
  Object.assign(form, DEFAULT_FORM)
}

function openCreate() {
  resetForm()
  showModal.value = true
}

function openEdit(row: ClientVersionRow) {
  Object.assign(form, {
    id: row.id,
    appKey: row.appKey,
    platform: row.platform,
    arch: row.arch,
    channel: row.channel,
    version: row.version,
    buildNumber: row.buildNumber,
    status: row.status,
    downloadUrl: row.downloadUrl || '',
    sha256: row.sha256 || '',
    signature: row.signature || '',
    releaseNotes: row.releaseNotes || '',
    forceUpdate: row.forceUpdate,
    minSupportedVersion: row.minSupportedVersion || '',
    rolloutPercent: row.rolloutPercent
  })
  showModal.value = true
}

function requestBody() {
  return {
    appKey: form.appKey,
    platform: form.platform,
    arch: form.arch,
    channel: form.channel,
    version: form.version,
    buildNumber: form.buildNumber,
    status: form.status,
    downloadUrl: form.downloadUrl,
    sha256: form.sha256,
    signature: form.signature,
    releaseNotes: form.releaseNotes,
    forceUpdate: form.forceUpdate,
    minSupportedVersion: form.minSupportedVersion,
    rolloutPercent: form.rolloutPercent
  }
}

async function saveVersion() {
  if (!form.version.trim()) {
    message.error('请填写版本号')
    return
  }

  saving.value = true
  try {
    if (form.id) {
      await $fetch(`/api/admin/client-versions/${form.id}`, {
        method: 'PATCH',
        body: requestBody()
      })
      message.success('版本已更新')
    } else {
      await $fetch('/api/admin/client-versions', {
        method: 'POST',
        body: requestBody()
      })
      message.success('版本已创建')
    }
    showModal.value = false
    await loadVersions()
  } catch (error) {
    message.error(errorText(error, '保存客户端版本失败'))
  } finally {
    saving.value = false
  }
}

async function updateVersionStatus(row: ClientVersionRow, status: ClientVersionRow['status']) {
  try {
    await $fetch(`/api/admin/client-versions/${row.id}`, {
      method: 'PATCH',
      body: { status }
    })
    message.success(status === 'published' ? '版本已发布' : '版本已禁用')
    await loadVersions()
  } catch (error) {
    message.error(errorText(error, '更新版本状态失败'))
  }
}

onMounted(loadVersions)
</script>

<style scoped>
.client-versions-filters {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) repeat(4, minmax(120px, 150px)) auto;
  gap: 8px;
  align-items: center;
}

.client-versions-pagination {
  min-height: 28px;
}

.device-version-section {
  margin-top: 8px;
}

.device-version-section__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 650;
}

.client-version-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 12px;
}

.client-version-number {
  width: 100%;
}

@media (max-width: 980px) {
  .client-versions-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .client-versions-filters,
  .client-version-form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
