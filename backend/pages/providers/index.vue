<template>
  <AdminShell>
    <div class="page">
      <div class="page-header page-header--actions">
        <n-space>
          <n-button
            :loading="importing"
            @click="openImportFile"
          >
            导入配置
          </n-button>
          <n-button
            type="primary"
            :loading="exporting"
            @click="exportProviders"
          >
            导出配置
          </n-button>
        </n-space>
      </div>

      <n-space vertical class="table-section">
        <n-alert type="warning">
          导出的配置文件包含供应商明文 Key，仅用于管理员备份和迁移。
        </n-alert>
        <n-data-table :columns="columns" :data="providers" :loading="pending" />
      </n-space>

      <input
        ref="importInputRef"
        class="provider-import-input"
        type="file"
        accept="application/json,.json"
        @change="importProviders"
      >

      <n-modal v-model:show="showProviderModal" preset="card" title="编辑供应商" style="width: 520px">
        <n-form v-if="editingProvider">
          <n-form-item label="显示名称">
            <n-input v-model:value="editingProvider.displayName" />
          </n-form-item>
          <n-form-item label="Base URL">
            <n-input v-model:value="editingProvider.baseUrl" />
          </n-form-item>
          <n-form-item label="启用">
            <n-switch v-model:value="editingProvider.enabled" />
          </n-form-item>
          <n-space justify="end">
            <n-button @click="showProviderModal = false">取消</n-button>
            <n-button type="primary" @click="saveProvider">保存</n-button>
          </n-space>
        </n-form>
      </n-modal>

      <n-modal
        v-model:show="showCredentialModal"
        preset="card"
        :title="credentialModalTitle"
        style="width: 560px"
      >
        <n-alert type="warning" style="margin-bottom: 16px">
          按客户端供应商配置显示凭证字段；提交会覆盖当前凭证，留空表示清空对应字段。
        </n-alert>
        <n-form>
          <template v-if="credentialProvider?.providerKey === 'kling'">
            <n-form-item label="Access Key">
              <n-input v-model:value="credentialForm.accessKey" type="password" show-password-on="click" />
            </n-form-item>
            <n-form-item label="Secret Key">
              <n-input v-model:value="credentialForm.secretKey" type="password" show-password-on="click" />
            </n-form-item>
          </template>
          <n-form-item v-else label="API Key">
            <n-input v-model:value="credentialForm.apiKey" type="password" show-password-on="click" />
          </n-form-item>
          <n-space justify="end">
            <n-button @click="showCredentialModal = false">取消</n-button>
            <n-button type="primary" @click="saveCredentials">保存凭证</n-button>
          </n-space>
        </n-form>
      </n-modal>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NButton, NSpace, NTag, useMessage } from 'naive-ui'

interface ProviderRow {
  id: string
  providerKey: string
  displayName: string
  baseUrl: string
  enabled: boolean
  hasApiKey: boolean
  hasAccessKey: boolean
  hasSecretKey: boolean
}

const message = useMessage()
const providers = ref<ProviderRow[]>([])
const pending = ref(false)
const exporting = ref(false)
const importing = ref(false)
const importInputRef = ref<HTMLInputElement | null>(null)
const showProviderModal = ref(false)
const showCredentialModal = ref(false)
const editingProvider = ref<ProviderRow | null>(null)
const credentialProvider = ref<ProviderRow | null>(null)
const credentialProviderId = ref('')
const credentialForm = reactive({
  apiKey: '',
  accessKey: '',
  secretKey: ''
})

const credentialModalTitle = computed(() => {
  return credentialProvider.value
    ? `更新 ${credentialProvider.value.displayName} 凭证`
    : '更新凭证'
})

const columns = [
  { title: '供应商', key: 'displayName' },
  { title: '标识', key: 'providerKey' },
  { title: 'Base URL', key: 'baseUrl' },
  {
    title: '状态',
    key: 'enabled',
    render(row: ProviderRow) {
      return h(NTag, { size: 'small', type: row.enabled ? 'success' : 'error' }, { default: () => row.enabled ? '启用' : '禁用' })
    }
  },
  {
    title: '凭证',
    key: 'credentials',
    render(row: ProviderRow) {
      const tags = row.providerKey === 'kling'
        ? [
            row.hasAccessKey ? 'Access Key' : '',
            row.hasSecretKey ? 'Secret Key' : ''
          ].filter(Boolean)
        : [
            row.hasApiKey ? 'API Key' : ''
          ].filter(Boolean)
      return tags.length
        ? h(NSpace, { size: 4 }, { default: () => tags.map(tag => h(NTag, { size: 'small' }, { default: () => tag })) })
        : h(NTag, { size: 'small', type: 'warning' }, { default: () => '未配置' })
    }
  },
  {
    title: '操作',
    key: 'actions',
    render(row: ProviderRow) {
      return h(NSpace, { size: 8 }, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openProvider(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'primary', onClick: () => openCredentials(row) }, { default: () => '更新 Key' })
        ]
      })
    }
  }
]

async function loadProviders() {
  pending.value = true
  try {
    const response = await $fetch<{ data: { providers: ProviderRow[] } }>('/api/admin/model-providers')
    providers.value = response.data.providers
  } finally {
    pending.value = false
  }
}

function openProvider(row: ProviderRow) {
  editingProvider.value = { ...row }
  showProviderModal.value = true
}

function openCredentials(row: ProviderRow) {
  credentialProvider.value = row
  credentialProviderId.value = row.id
  Object.assign(credentialForm, { apiKey: '', accessKey: '', secretKey: '' })
  showCredentialModal.value = true
}

async function saveProvider() {
  if (!editingProvider.value) return
  await $fetch(`/api/admin/model-providers/${editingProvider.value.id}`, {
    method: 'PUT',
    body: {
      displayName: editingProvider.value.displayName,
      baseUrl: editingProvider.value.baseUrl,
      enabled: editingProvider.value.enabled
    }
  })
  message.success('供应商已更新')
  showProviderModal.value = false
  await loadProviders()
}

async function saveCredentials() {
  const body = credentialProvider.value?.providerKey === 'kling'
    ? {
        accessKey: credentialForm.accessKey,
        secretKey: credentialForm.secretKey
      }
    : {
        apiKey: credentialForm.apiKey
      }
  await $fetch(`/api/admin/model-providers/${credentialProviderId.value}/credentials`, {
    method: 'PUT',
    body
  })
  message.success('凭证已更新')
  showCredentialModal.value = false
  await loadProviders()
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function openImportFile() {
  importInputRef.value?.click()
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function filenameFromDisposition(value: string | null) {
  const match = value?.match(/filename="([^"]+)"/)
  return match?.[1] || `playlet-model-providers-${new Date().toISOString().slice(0, 10)}.json`
}

async function exportProviders() {
  exporting.value = true
  try {
    const response = await fetch('/api/admin/model-providers/export', {
      credentials: 'include'
    })
    if (!response.ok) {
      throw new Error(await response.text() || '导出失败')
    }
    downloadBlob(
      await response.blob(),
      filenameFromDisposition(response.headers.get('content-disposition'))
    )
    message.success('供应商配置已导出')
  } catch (err) {
    message.error(errorMessage(err, '导出失败'))
  } finally {
    exporting.value = false
  }
}

async function importProviders(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  importing.value = true
  try {
    const payload = JSON.parse(await file.text()) as unknown
    const response = await $fetch<{
      data: {
        created: number
        updated: number
        credentialsUpdated: number
      }
    }>('/api/admin/model-providers/import', {
      method: 'POST',
      body: payload
    })
    message.success(`导入完成：新增 ${response.data.created}，更新 ${response.data.updated}，凭证 ${response.data.credentialsUpdated}`)
    await loadProviders()
  } catch (err) {
    message.error(errorMessage(err, '导入失败'))
  } finally {
    importing.value = false
  }
}

onMounted(loadProviders)
</script>

<style scoped>
.provider-import-input {
  display: none;
}
</style>
