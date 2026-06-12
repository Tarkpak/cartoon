<template>
  <AdminShell>
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">供应商 Key</h1>
          <p class="page-subtitle">Key 加密存储，页面只显示是否已配置，不回显明文。</p>
        </div>
      </div>

      <n-card>
        <n-data-table :columns="columns" :data="providers" :loading="pending" />
      </n-card>

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

      <n-modal v-model:show="showCredentialModal" preset="card" title="更新凭证" style="width: 560px">
        <n-alert type="warning" style="margin-bottom: 16px">
          提交会覆盖该供应商当前凭证；留空表示清空对应字段。
        </n-alert>
        <n-form>
          <n-form-item label="API Key">
            <n-input v-model:value="credentialForm.apiKey" type="password" show-password-on="click" />
          </n-form-item>
          <n-form-item label="Access Key">
            <n-input v-model:value="credentialForm.accessKey" type="password" show-password-on="click" />
          </n-form-item>
          <n-form-item label="Secret Key">
            <n-input v-model:value="credentialForm.secretKey" type="password" show-password-on="click" />
          </n-form-item>
          <n-form-item label="Security Token">
            <n-input v-model:value="credentialForm.securityToken" type="password" show-password-on="click" />
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
  hasSecurityToken: boolean
}

const message = useMessage()
const providers = ref<ProviderRow[]>([])
const pending = ref(false)
const showProviderModal = ref(false)
const showCredentialModal = ref(false)
const editingProvider = ref<ProviderRow | null>(null)
const credentialProviderId = ref('')
const credentialForm = reactive({
  apiKey: '',
  accessKey: '',
  secretKey: '',
  securityToken: ''
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
      const tags = [
        row.hasApiKey ? 'API Key' : '',
        row.hasAccessKey ? 'Access Key' : '',
        row.hasSecretKey ? 'Secret Key' : '',
        row.hasSecurityToken ? 'Token' : ''
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
  credentialProviderId.value = row.id
  Object.assign(credentialForm, { apiKey: '', accessKey: '', secretKey: '', securityToken: '' })
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
  await $fetch(`/api/admin/model-providers/${credentialProviderId.value}/credentials`, {
    method: 'PUT',
    body: credentialForm
  })
  message.success('凭证已更新')
  showCredentialModal.value = false
  await loadProviders()
}

onMounted(loadProviders)
</script>

