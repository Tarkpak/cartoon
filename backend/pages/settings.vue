<template>
  <AdminShell>
    <div class="page settings-page">
      <n-spin :show="pending || storagePending">
        <n-space vertical size="large" class="settings-stack">
          <n-card :bordered="false" class="settings-card">
            <div class="settings-section-heading">
              <span class="settings-section-title">系统设置</span>
            </div>
            <n-form label-placement="left" label-width="160">
              <n-form-item label="每用户最大设备数">
                <n-input-number v-model:value="form.maxDevicesPerUser" class="settings-number" :min="1" />
              </n-form-item>
              <n-form-item label="限制同时在线">
                <n-switch v-model:value="form.restrictConcurrentDevices" />
              </n-form-item>
              <n-form-item label="最大同时在线设备">
                <n-input-number v-model:value="form.maxConcurrentDevices" class="settings-number" :min="1" />
              </n-form-item>
              <n-form-item label="禁用失效秒数">
                <n-input-number v-model:value="form.disabledGraceSeconds" class="settings-number" :min="0" />
              </n-form-item>
              <n-form-item label="日志归档阈值">
                <n-input-number v-model:value="form.logArchiveMaxRows" class="settings-number" :min="1000" />
              </n-form-item>
              <n-space justify="end">
                <n-button type="primary" :loading="saving" @click="save">保存系统设置</n-button>
              </n-space>
            </n-form>
          </n-card>

          <n-card :bordered="false" class="settings-card">
            <div class="settings-section-heading">
              <span class="settings-section-title">云存储</span>
              <n-tag size="small" :type="storageForm.enabled ? 'success' : 'default'">
                {{ storageForm.enabled ? '已启用' : '未启用' }}
              </n-tag>
            </div>

            <n-form label-placement="top">
              <div class="storage-grid">
                <n-form-item label="启用 TOS 云存储" class="storage-grid__wide">
                  <n-switch v-model:value="storageForm.enabled" />
                </n-form-item>

                <n-form-item label="Access Key ID">
                  <n-input v-model:value="storageForm.accessKeyId" placeholder="AKxxxxxxxx" />
                </n-form-item>

                <n-form-item label="Secret Key">
                  <div class="secret-field">
                    <n-input
                      v-model:value="storageForm.secretKey"
                      type="password"
                      show-password-on="click"
                      :placeholder="storageHasSecretKey ? '已保存，留空保留' : '请输入 Secret Key'"
                    />
                    <n-tag size="small" :type="storageHasSecretKey ? 'success' : 'default'">
                      {{ storageHasSecretKey ? '已保存' : '未保存' }}
                    </n-tag>
                  </div>
                </n-form-item>

                <n-form-item label="Region">
                  <n-input v-model:value="storageForm.region" placeholder="cn-guangzhou" />
                </n-form-item>

                <n-form-item label="Endpoint">
                  <n-input v-model:value="storageForm.endpoint" placeholder="tos-cn-guangzhou.volces.com" />
                </n-form-item>

                <n-form-item label="Bucket">
                  <n-input v-model:value="storageForm.bucket" placeholder="my-bucket" />
                </n-form-item>

                <n-form-item label="Key Prefix">
                  <n-input v-model:value="storageForm.keyPrefix" placeholder="playlet-assets" />
                </n-form-item>

                <n-form-item label="Security Token">
                  <div class="secret-field">
                    <n-input
                      v-model:value="storageForm.securityToken"
                      type="password"
                      show-password-on="click"
                      :placeholder="storageHasSecurityToken ? '已保存，留空保留' : 'STS 临时令牌（可选）'"
                    />
                    <n-tag size="small" :type="storageHasSecurityToken ? 'success' : 'default'">
                      {{ storageHasSecurityToken ? '已保存' : '未保存' }}
                    </n-tag>
                  </div>
                </n-form-item>

                <n-form-item label="Public Base URL">
                  <n-input v-model:value="storageForm.publicBaseUrl" placeholder="https://cdn.example.com" />
                </n-form-item>

                <n-form-item label="自定义域名">
                  <n-switch v-model:value="storageForm.isCustomDomain" />
                </n-form-item>
              </div>

              <n-space justify="end">
                <n-button type="primary" :loading="storageSaving" @click="saveStorageConfig">保存云存储</n-button>
              </n-space>
            </n-form>
          </n-card>
        </n-space>
      </n-spin>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui'

interface AppSettingsForm {
  maxDevicesPerUser: number
  restrictConcurrentDevices: boolean
  maxConcurrentDevices: number
  disabledGraceSeconds: number
  logArchiveMaxRows: number
}

interface TosStoragePublic {
  enabled: boolean
  accessKeyId: string
  hasSecretKey: boolean
  hasSecurityToken: boolean
  region: string
  endpoint: string
  bucket: string
  keyPrefix: string
  publicBaseUrl: string
  isCustomDomain: boolean
}

const message = useMessage()
const pending = ref(false)
const saving = ref(false)
const storagePending = ref(false)
const storageSaving = ref(false)
const storageHasSecretKey = ref(false)
const storageHasSecurityToken = ref(false)

const form = reactive<AppSettingsForm>({
  maxDevicesPerUser: 3,
  restrictConcurrentDevices: false,
  maxConcurrentDevices: 1,
  disabledGraceSeconds: 60,
  logArchiveMaxRows: 50000
})

const storageForm = reactive({
  enabled: false,
  accessKeyId: '',
  secretKey: '',
  securityToken: '',
  region: '',
  endpoint: '',
  bucket: '',
  keyPrefix: '',
  publicBaseUrl: '',
  isCustomDomain: false
})

function errorText(error: unknown, fallback: string) {
  const data = (error as { data?: { statusMessage?: string, message?: string } })?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : fallback)
}

function applyStorageConfig(data: TosStoragePublic) {
  storageForm.enabled = data.enabled
  storageForm.accessKeyId = data.accessKeyId || ''
  storageForm.secretKey = ''
  storageForm.securityToken = ''
  storageForm.region = data.region || ''
  storageForm.endpoint = data.endpoint || ''
  storageForm.bucket = data.bucket || ''
  storageForm.keyPrefix = data.keyPrefix || ''
  storageForm.publicBaseUrl = data.publicBaseUrl || ''
  storageForm.isCustomDomain = data.isCustomDomain
  storageHasSecretKey.value = data.hasSecretKey
  storageHasSecurityToken.value = data.hasSecurityToken
}

function missingStorageFields() {
  if (!storageForm.enabled) return []
  const missing: string[] = []
  if (!storageForm.accessKeyId.trim()) missing.push('Access Key ID')
  if (!storageHasSecretKey.value && !storageForm.secretKey.trim()) missing.push('Secret Key')
  if (!storageForm.region.trim()) missing.push('Region')
  if (!storageForm.endpoint.trim()) missing.push('Endpoint')
  if (!storageForm.bucket.trim()) missing.push('Bucket')
  return missing
}

async function load() {
  pending.value = true
  try {
    const response = await $fetch<{ data: AppSettingsForm }>('/api/admin/settings')
    Object.assign(form, response.data)
  } catch (error) {
    message.error(errorText(error, '加载系统设置失败'))
  } finally {
    pending.value = false
  }
}

async function loadStorageConfig() {
  storagePending.value = true
  try {
    const response = await $fetch<{ data: TosStoragePublic }>('/api/admin/tos-storage/config')
    applyStorageConfig(response.data)
  } catch (error) {
    message.error(errorText(error, '加载云存储配置失败'))
  } finally {
    storagePending.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const response = await $fetch<{ data: AppSettingsForm }>('/api/admin/settings', {
      method: 'PUT',
      body: form
    })
    Object.assign(form, response.data)
    message.success('系统设置已保存')
  } catch (error) {
    message.error(errorText(error, '保存系统设置失败'))
  } finally {
    saving.value = false
  }
}

async function saveStorageConfig() {
  const missing = missingStorageFields()
  if (missing.length > 0) {
    message.error(`启用云存储前请补齐：${missing.join('、')}`)
    return
  }

  storageSaving.value = true
  try {
    const body: Record<string, unknown> = {
      enabled: storageForm.enabled,
      accessKeyId: storageForm.accessKeyId,
      region: storageForm.region,
      endpoint: storageForm.endpoint,
      bucket: storageForm.bucket,
      keyPrefix: storageForm.keyPrefix,
      publicBaseUrl: storageForm.publicBaseUrl,
      isCustomDomain: storageForm.isCustomDomain
    }

    if (storageForm.secretKey.trim() || !storageHasSecretKey.value) {
      body.secretKey = storageForm.secretKey
    }
    if (storageForm.securityToken.trim() || !storageHasSecurityToken.value) {
      body.securityToken = storageForm.securityToken
    }

    const response = await $fetch<{ data: TosStoragePublic }>('/api/admin/tos-storage/config', {
      method: 'PUT',
      body
    })
    applyStorageConfig(response.data)
    message.success('云存储配置已保存')
  } catch (error) {
    message.error(errorText(error, '保存云存储配置失败'))
  } finally {
    storageSaving.value = false
  }
}

onMounted(() => {
  void load()
  void loadStorageConfig()
})
</script>

<style scoped>
.settings-page {
  max-width: 1120px;
}

.settings-stack {
  width: 100%;
}

.settings-card {
  border-radius: 8px;
}

.settings-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.settings-section-title {
  color: #1f2328;
  font-size: 15px;
  font-weight: 650;
}

.settings-number {
  width: 180px;
}

.storage-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 16px;
}

.storage-grid__wide {
  grid-column: 1 / -1;
}

.secret-field {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.secret-field :deep(.n-input) {
  min-width: 0;
  flex: 1 1 auto;
}

@media (max-width: 900px) {
  .storage-grid {
    grid-template-columns: 1fr;
  }
}
</style>
