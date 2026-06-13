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
        <n-data-table
          :columns="columns"
          :data="providers"
          :loading="pending"
          :row-props="rowProps"
        />
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

      <n-drawer v-model:show="showModelsDrawer" width="min(720px, 100vw)" placement="right">
        <n-drawer-content :title="modelsDrawerTitle" closable>
          <div v-if="modelsProvider" class="provider-models">
            <n-space justify="space-between" align="center" class="provider-models__toolbar">
              <n-space size="small">
                <n-tag size="small" type="success">
                  已选 {{ modelDraft.length }}
                </n-tag>
                <n-tag size="small">
                  可用 {{ providerAvailableModels.length }}
                </n-tag>
                <n-tag v-if="modelsProvider.supportedDynamicSync" size="small" type="info">
                  支持同步
                </n-tag>
              </n-space>
              <n-space size="small">
                <n-button size="small" :disabled="!modelsProvider.configured || providerAvailableModels.length === 0 || savingModels" @click="selectAllModelDraft">
                  全选
                </n-button>
                <n-button size="small" :disabled="!modelsProvider.configured || modelDraft.length === 0 || savingModels" @click="clearModelDraft">
                  清空
                </n-button>
                <n-button
                  v-if="modelsProvider.supportedDynamicSync"
                  size="small"
                  :loading="syncingModels"
                  :disabled="!modelsProvider.configured || savingModels"
                  @click="syncProviderModels"
                >
                  同步模型
                </n-button>
              </n-space>
            </n-space>

            <n-alert v-if="modelsProvider.syncError" type="warning" class="provider-models__alert">
              {{ modelsProvider.syncError }}
            </n-alert>
            <n-alert v-if="!modelsProvider.configured" type="warning" class="provider-models__alert">
              请先配置供应商 Key，再查看和选择模型。
            </n-alert>

            <n-input v-model:value="modelSearchKeyword" clearable placeholder="搜索模型 ID" />

            <div v-if="providerModelGroups.length === 0" class="provider-models__empty">
              暂无可选模型
            </div>
            <div v-else class="provider-models__groups">
              <section
                v-for="group in providerModelGroups"
                :key="`${modelsProvider.providerKey}_${group.key}`"
                class="provider-models__group"
              >
                <div class="provider-models__group-header">
                  <span>{{ group.label }}</span>
                  <n-tag size="small">{{ group.models.length }}</n-tag>
                </div>
                <div class="provider-models__grid">
                  <n-checkbox
                    v-for="model in group.models"
                    :key="`${modelsProvider.providerKey}_${model}`"
                    :checked="isDraftModelSelected(model)"
                    :disabled="savingModels"
                    @update:checked="value => updateDraftModel(model, value)"
                  >
                    <span class="provider-models__model-id">{{ model }}</span>
                  </n-checkbox>
                </div>
              </section>
            </div>
          </div>

          <template #footer>
            <n-space justify="end">
              <n-button @click="showModelsDrawer = false">关闭</n-button>
              <n-button type="primary" :loading="savingModels" :disabled="!modelsProvider?.configured" @click="saveProviderModels">
                保存模型
              </n-button>
            </n-space>
          </template>
        </n-drawer-content>
      </n-drawer>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NButton, NEllipsis, NSpace, NTag, useMessage } from 'naive-ui'

interface ModelCatalogEntry {
  model: string
  category: string
}

interface ProviderRow {
  id: string
  providerKey: string
  displayName: string
  baseUrl: string
  enabled: boolean
  hasApiKey: boolean
  hasAccessKey: boolean
  hasSecretKey: boolean
  configured: boolean
  supportedDynamicSync: boolean
  modelCount: number
  models: string[]
  availableModels: string[]
  availableModelCatalog: ModelCatalogEntry[]
  syncedAt: string | null
  syncError: string | null
}

interface ProviderModelUpdate {
  providerKey: string
  modelCount: number
  models: string[]
  availableModels: string[]
  availableModelCatalog: ModelCatalogEntry[]
  syncedAt: string | null
  syncError: string | null
}

type ModelCategoryKey = 'text' | 'image' | 'video' | 'voice' | 'three_d' | 'other'

interface ModelCategoryGroup {
  key: ModelCategoryKey
  label: string
  models: string[]
}

const MODEL_CATEGORY_ORDER: ModelCategoryKey[] = ['text', 'image', 'video', 'voice', 'three_d', 'other']
const MODEL_CATEGORY_LABEL: Record<ModelCategoryKey, string> = {
  text: '文本模型',
  image: '图片模型',
  video: '视频模型',
  voice: '语音模型',
  three_d: '3D 模型',
  other: '其他模型'
}

const message = useMessage()
const providers = ref<ProviderRow[]>([])
const pending = ref(false)
const exporting = ref(false)
const importing = ref(false)
const importInputRef = ref<HTMLInputElement | null>(null)
const showProviderModal = ref(false)
const showCredentialModal = ref(false)
const showModelsDrawer = ref(false)
const editingProvider = ref<ProviderRow | null>(null)
const credentialProvider = ref<ProviderRow | null>(null)
const modelsProvider = ref<ProviderRow | null>(null)
const credentialProviderId = ref('')
const modelDraft = ref<string[]>([])
const modelSearchKeyword = ref('')
const savingModels = ref(false)
const syncingModels = ref(false)
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

const modelsDrawerTitle = computed(() => {
  return modelsProvider.value
    ? `${modelsProvider.value.displayName} 模型`
    : '供应商模型'
})

const providerAvailableModels = computed(() => {
  return modelsProvider.value ? availableModelsFor(modelsProvider.value) : []
})

const providerModelGroups = computed<ModelCategoryGroup[]>(() => {
  if (!modelsProvider.value) return []
  const keyword = modelSearchKeyword.value.trim().toLowerCase()
  const categoryMap = new Map<string, ModelCategoryKey>()
  for (const entry of modelsProvider.value.availableModelCatalog || []) {
    categoryMap.set(entry.model, normalizeCategory(entry.category))
  }

  const groups: Record<ModelCategoryKey, string[]> = {
    text: [],
    image: [],
    video: [],
    voice: [],
    three_d: [],
    other: []
  }
  for (const model of providerAvailableModels.value) {
    if (keyword && !model.toLowerCase().includes(keyword)) continue
    const category = categoryMap.get(model) || 'other'
    groups[category].push(model)
  }

  return MODEL_CATEGORY_ORDER
    .map(key => ({
      key,
      label: MODEL_CATEGORY_LABEL[key],
      models: groups[key].sort((a, b) => a.localeCompare(b))
    }))
    .filter(group => group.models.length > 0)
})

const columns = [
  { title: '供应商', key: 'displayName' },
  { title: '标识', key: 'providerKey' },
  {
    title: 'Base URL',
    key: 'baseUrl',
    width: 280,
    render(row: ProviderRow) {
      return h(
        NEllipsis,
        {
          style: { maxWidth: '280px' },
          tooltip: true
        },
        { default: () => row.baseUrl || '-' }
      )
    }
  },
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
    title: '模型',
    key: 'models',
    render(row: ProviderRow) {
      return h(NSpace, { size: 4 }, {
        default: () => [
          h(NTag, { size: 'small', type: row.modelCount > 0 ? 'success' : 'warning' }, { default: () => `已选 ${row.modelCount}` }),
          h(NTag, { size: 'small' }, { default: () => `可用 ${availableModelsFor(row).length}` })
        ]
      })
    }
  },
  {
    title: '操作',
    key: 'actions',
    render(row: ProviderRow) {
      return h(NSpace, { size: 8 }, {
        default: () => [
          h(NButton, { size: 'small', onClick: (event: MouseEvent) => handleActionClick(event, () => openProvider(row)) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'primary', onClick: (event: MouseEvent) => handleActionClick(event, () => openCredentials(row)) }, { default: () => '更新 Key' })
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

function handleActionClick(event: MouseEvent, action: () => void) {
  event.stopPropagation()
  action()
}

function rowProps(row: ProviderRow) {
  return {
    class: row.configured ? 'provider-table-row provider-table-row--clickable' : 'provider-table-row',
    onClick: () => {
      if (row.configured) {
        openModels(row)
      }
    }
  }
}

function openModels(row: ProviderRow) {
  modelsProvider.value = cloneProviderRow(row)
  modelDraft.value = [...row.models]
  modelSearchKeyword.value = ''
  showModelsDrawer.value = true
}

function cloneProviderRow(row: ProviderRow): ProviderRow {
  return {
    ...row,
    models: [...(row.models || [])],
    availableModels: [...(row.availableModels || [])],
    availableModelCatalog: [...(row.availableModelCatalog || [])]
  }
}

function normalizeCategory(value: string): ModelCategoryKey {
  if (value === 'text') return 'text'
  if (value === 'image') return 'image'
  if (value === 'video') return 'video'
  if (value === 'voice') return 'voice'
  if (value === 'three_d') return 'three_d'
  return 'other'
}

function availableModelsFor(provider: ProviderRow) {
  return Array.from(new Set([...(provider.availableModels || []), ...(provider.models || [])]))
}

function isDraftModelSelected(model: string) {
  return modelDraft.value.includes(model)
}

function updateDraftModel(model: string, value: boolean | 'indeterminate') {
  const selected = new Set(modelDraft.value)
  if (value === true) {
    selected.add(model)
  } else {
    selected.delete(model)
  }
  modelDraft.value = providerAvailableModels.value.filter(item => selected.has(item))
}

function selectAllModelDraft() {
  modelDraft.value = [...providerAvailableModels.value]
}

function clearModelDraft() {
  modelDraft.value = []
}

function applyProviderModelUpdate(providerId: string, update: ProviderModelUpdate) {
  providers.value = providers.value.map(row => row.id === providerId
    ? {
        ...row,
        modelCount: update.modelCount,
        models: [...update.models],
        availableModels: [...update.availableModels],
        availableModelCatalog: [...update.availableModelCatalog],
        syncedAt: update.syncedAt,
        syncError: update.syncError
      }
    : row)

  if (modelsProvider.value?.id === providerId) {
    const updatedProvider = providers.value.find(row => row.id === providerId)
    if (updatedProvider) {
      modelsProvider.value = cloneProviderRow(updatedProvider)
      modelDraft.value = [...updatedProvider.models]
    }
  }
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

async function saveProviderModels() {
  if (!modelsProvider.value) return
  savingModels.value = true
  try {
    const response = await $fetch<{ data: ProviderModelUpdate }>(`/api/admin/model-providers/${modelsProvider.value.id}/models`, {
      method: 'PUT',
      body: {
        models: modelDraft.value
      }
    })
    applyProviderModelUpdate(modelsProvider.value.id, response.data)
    message.success('模型选择已保存')
  } catch (err) {
    message.error(errorMessage(err, '保存模型失败'))
  } finally {
    savingModels.value = false
  }
}

async function syncProviderModels() {
  if (!modelsProvider.value) return
  syncingModels.value = true
  try {
    const response = await $fetch<{ data: ProviderModelUpdate }>(`/api/admin/model-providers/${modelsProvider.value.id}/models/sync`, {
      method: 'POST'
    })
    applyProviderModelUpdate(modelsProvider.value.id, response.data)
    message.success('模型已同步')
  } catch (err) {
    message.error(errorMessage(err, '同步模型失败'))
    await loadProviders()
    const refreshed = providers.value.find(provider => provider.id === modelsProvider.value?.id)
    if (refreshed) {
      modelsProvider.value = cloneProviderRow(refreshed)
      modelDraft.value = [...refreshed.models]
    }
  } finally {
    syncingModels.value = false
  }
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
        modelSelectionsUpdated: number
      }
    }>('/api/admin/model-providers/import', {
      method: 'POST',
      body: payload
    })
    message.success(`导入完成：新增 ${response.data.created}，更新 ${response.data.updated}，凭证 ${response.data.credentialsUpdated}，模型 ${response.data.modelSelectionsUpdated || 0}`)
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

:deep(.provider-table-row--clickable) {
  cursor: pointer;
}

:deep(.provider-table-row--clickable:hover td) {
  background: #f9fafb;
}

.provider-models {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-models__toolbar {
  gap: 8px;
}

.provider-models__alert {
  margin-top: 2px;
}

.provider-models__empty {
  border: 1px dashed #d0d5dd;
  border-radius: 6px;
  color: #667085;
  padding: 24px;
  text-align: center;
}

.provider-models__groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: calc(100vh - 260px);
  overflow-y: auto;
  padding-right: 2px;
}

.provider-models__group {
  border: 1px solid #e4e7ec;
  border-radius: 6px;
  padding: 10px;
}

.provider-models__group-header {
  align-items: center;
  display: flex;
  font-size: 13px;
  font-weight: 600;
  justify-content: space-between;
  margin-bottom: 8px;
}

.provider-models__grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.provider-models__model-id {
  display: inline-block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .provider-models__grid {
    grid-template-columns: 1fr;
  }

  .provider-models__model-id {
    max-width: 70vw;
  }
}
</style>
