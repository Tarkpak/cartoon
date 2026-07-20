<template>
  <AdminShell>
    <div class="page settings-page">
      <n-spin :show="pending || storagePending || wxChannelsPending">
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
              <span class="settings-section-title">积分计费规则</span>
              <n-button size="small" type="primary" @click="showCreditRuleCreate = true">新增规则</n-button>
            </div>
            <n-text depth="3" class="settings-help">
              模型调用成功后按操作类型扣除整数积分；失败调用不扣分。兜底规则用于尚未单独配置的操作。
            </n-text>
            <n-form label-placement="left" label-width="150">
              <n-form-item
                v-for="rule in creditRules"
                :key="rule.id"
                :label="creditRuleLabel(rule.operation)"
              >
                <n-space align="center">
                  <n-tag size="small">{{ creditRuleScope(rule) }}</n-tag>
                  <n-input-number v-model:value="rule.credits" :min="0" :max="1000000" :precision="0" />
                  <n-switch v-model:value="rule.enabled" />
                  <n-text depth="3">积分 / 次</n-text>
                  <n-button
                    v-if="!rule.id.startsWith('credit_rule_')"
                    size="tiny"
                    type="error"
                    tertiary
                    @click="deleteCreditRule(rule)"
                  >
                    删除
                  </n-button>
                </n-space>
              </n-form-item>
              <n-space justify="end">
                <n-button type="primary" :loading="creditRulesSaving" @click="saveCreditRules">
                  保存积分规则
                </n-button>
              </n-space>
            </n-form>
          </n-card>

          <n-modal v-model:show="showCreditRuleCreate" preset="card" title="新增积分规则" style="width: 480px">
            <n-form label-placement="top">
              <n-form-item label="操作类型">
                <n-select v-model:value="creditRuleForm.operation" :options="creditOperationOptions" />
              </n-form-item>
              <n-form-item label="供应商（留空表示全部）">
                <n-select v-model:value="creditRuleForm.provider" clearable :options="creditProviderOptions" />
              </n-form-item>
              <n-form-item label="模型 ID（留空表示全部）">
                <n-input v-model:value="creditRuleForm.modelId" placeholder="例如 veo-3.1-generate-preview" />
              </n-form-item>
              <n-form-item label="每次扣除积分">
                <n-input-number v-model:value="creditRuleForm.credits" :min="0" :max="1000000" :precision="0" />
              </n-form-item>
              <n-space justify="end">
                <n-button @click="showCreditRuleCreate = false">取消</n-button>
                <n-button type="primary" :loading="creditRuleCreating" @click="createCreditRule">创建</n-button>
              </n-space>
            </n-form>
          </n-modal>

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

          <n-card :bordered="false" class="settings-card">
            <div class="settings-section-heading">
              <span class="settings-section-title">视频号下载</span>
              <n-tag size="small" :type="wxChannelsHasCookie ? 'success' : 'default'">
                {{ wxChannelsHasCookie ? '已配置' : '未配置' }}
              </n-tag>
            </div>

            <n-form label-placement="top">
              <n-form-item label="腾讯元宝 Cookie">
                <div class="secret-field">
                  <n-input
                    v-model:value="wxChannelsForm.yuanbaoCookie"
                    type="textarea"
                    :autosize="{ minRows: 4, maxRows: 8 }"
                    :placeholder="wxChannelsHasCookie ? '已保存，留空保留' : '粘贴腾讯元宝网页 Cookie'"
                  />
                  <n-tag size="small" :type="wxChannelsHasCookie ? 'success' : 'default'">
                    {{ wxChannelsHasCookie ? '已保存' : '未保存' }}
                  </n-tag>
                </div>
              </n-form-item>
              <n-text depth="3" class="settings-help">
                用于桌面端通过视频号 SPH 分享链接解析视频。Cookie 只保存在后台，客户端同步时通过加密通道读取。
              </n-text>

              <n-space justify="end">
                <n-button
                  tertiary
                  type="error"
                  :disabled="!wxChannelsHasCookie"
                  :loading="wxChannelsSaving"
                  @click="clearWxChannelsConfig"
                >
                  清空 Cookie
                </n-button>
                <n-button type="primary" :loading="wxChannelsSaving" @click="saveWxChannelsConfig">
                  保存视频号配置
                </n-button>
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

interface WxChannelsPublic {
  hasYuanbaoCookie: boolean
  updatedAt?: string | null
}

interface CreditRule {
  id: string
  operation: string
  provider: string
  model_id: string
  credits: number
  enabled: boolean
}

const message = useMessage()
const pending = ref(false)
const saving = ref(false)
const storagePending = ref(false)
const storageSaving = ref(false)
const storageHasSecretKey = ref(false)
const storageHasSecurityToken = ref(false)
const wxChannelsPending = ref(false)
const wxChannelsSaving = ref(false)
const creditRulesSaving = ref(false)
const creditRules = ref<CreditRule[]>([])
const showCreditRuleCreate = ref(false)
const creditRuleCreating = ref(false)
const creditRuleForm = reactive({
  operation: 'generateText',
  provider: '',
  modelId: '',
  credits: 1
})
const creditOperationOptions = [
  { label: '文本生成', value: 'generateText' },
  { label: '图片生成', value: 'generateImage' },
  { label: '视频生成', value: 'generateVideo' },
  { label: '语音生成', value: 'textToSpeech' },
  { label: '其他操作（兜底）', value: '*' }
]
const creditProviderOptions = [
  { label: 'Gemini', value: 'gemini' },
  { label: '通义千问', value: 'qwen' },
  { label: '火山方舟', value: 'volcengine' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: '可灵', value: 'kling' },
  { label: '自定义 OpenAI', value: 'custom_openai' }
]
const wxChannelsHasCookie = ref(false)

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

const wxChannelsForm = reactive({
  yuanbaoCookie: ''
})

function errorText(error: unknown, fallback: string) {
  const data = (error as { data?: { statusMessage?: string, message?: string } })?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : fallback)
}

function creditRuleLabel(operation: string) {
  const labels: Record<string, string> = {
    '*': '其他操作（兜底）',
    generateText: '文本生成',
    generateImage: '图片生成',
    generateVideo: '视频生成',
    textToSpeech: '语音生成'
  }
  return labels[operation] || operation
}

function creditRuleScope(rule: CreditRule) {
  const parts = [rule.provider || '全部供应商', rule.model_id || '全部模型']
  return parts.join(' / ')
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

function applyWxChannelsConfig(data: WxChannelsPublic) {
  wxChannelsForm.yuanbaoCookie = ''
  wxChannelsHasCookie.value = data.hasYuanbaoCookie
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

async function loadWxChannelsConfig() {
  wxChannelsPending.value = true
  try {
    const response = await $fetch<{ data: WxChannelsPublic }>('/api/admin/wx-channels/config')
    applyWxChannelsConfig(response.data)
  } catch (error) {
    message.error(errorText(error, '加载视频号配置失败'))
  } finally {
    wxChannelsPending.value = false
  }
}

async function loadCreditRules() {
  try {
    const response = await $fetch<{ data: { rules: Array<Omit<CreditRule, 'enabled'> & { enabled: number | boolean }> } }>('/api/admin/credit-rules')
    creditRules.value = response.data.rules.map(rule => ({
      ...rule,
      enabled: rule.enabled === true || rule.enabled === 1
    }))
  } catch (error) {
    message.error(errorText(error, '加载积分规则失败'))
  }
}

async function saveCreditRules() {
  creditRulesSaving.value = true
  try {
    await $fetch('/api/admin/credit-rules', {
      method: 'PUT',
      body: {
        rules: creditRules.value.map(rule => ({
          id: rule.id,
          credits: rule.credits,
          enabled: rule.enabled
        }))
      }
    })
    message.success('积分规则已保存')
    await loadCreditRules()
  } catch (error) {
    message.error(errorText(error, '保存积分规则失败'))
  } finally {
    creditRulesSaving.value = false
  }
}

async function createCreditRule() {
  creditRuleCreating.value = true
  try {
    await $fetch('/api/admin/credit-rules', {
      method: 'POST',
      body: creditRuleForm
    })
    message.success('积分规则已创建')
    showCreditRuleCreate.value = false
    Object.assign(creditRuleForm, { operation: 'generateText', provider: '', modelId: '', credits: 1 })
    await loadCreditRules()
  } catch (error) {
    message.error(errorText(error, '创建积分规则失败'))
  } finally {
    creditRuleCreating.value = false
  }
}

async function deleteCreditRule(rule: CreditRule) {
  try {
    await $fetch(`/api/admin/credit-rules/${rule.id}`, { method: 'DELETE' })
    message.success('积分规则已删除')
    await loadCreditRules()
  } catch (error) {
    message.error(errorText(error, '删除积分规则失败'))
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

async function saveWxChannelsConfig() {
  if (!wxChannelsHasCookie.value && !wxChannelsForm.yuanbaoCookie.trim()) {
    message.error('请填写腾讯元宝 Cookie')
    return
  }

  wxChannelsSaving.value = true
  try {
    const body: Record<string, unknown> = {}
    if (wxChannelsForm.yuanbaoCookie.trim() || !wxChannelsHasCookie.value) {
      body.yuanbaoCookie = wxChannelsForm.yuanbaoCookie
    }
    const response = await $fetch<{ data: WxChannelsPublic }>('/api/admin/wx-channels/config', {
      method: 'PUT',
      body
    })
    applyWxChannelsConfig(response.data)
    message.success('视频号配置已保存')
  } catch (error) {
    message.error(errorText(error, '保存视频号配置失败'))
  } finally {
    wxChannelsSaving.value = false
  }
}

async function clearWxChannelsConfig() {
  wxChannelsSaving.value = true
  try {
    const response = await $fetch<{ data: WxChannelsPublic }>('/api/admin/wx-channels/config', {
      method: 'PUT',
      body: { clear: true }
    })
    applyWxChannelsConfig(response.data)
    message.success('视频号 Cookie 已清空')
  } catch (error) {
    message.error(errorText(error, '清空视频号配置失败'))
  } finally {
    wxChannelsSaving.value = false
  }
}

onMounted(() => {
  void load()
  void loadStorageConfig()
  void loadWxChannelsConfig()
  void loadCreditRules()
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

.settings-help {
  display: block;
  margin: -8px 0 16px;
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
