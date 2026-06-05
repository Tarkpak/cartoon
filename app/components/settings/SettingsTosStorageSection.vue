<script setup lang="ts">
import { Check, Loader2, Save, X } from 'lucide-vue-next'
import type { TosConfigPublic } from '#shared/types/provider'

interface TosConfigResponse {
  success: boolean
  data: TosConfigPublic
}

const loading = ref(false)
const saving = ref(false)
const message = ref('')
const errorMessage = ref('')

const enabled = ref(false)
const accessKeyId = ref('')
const secretKeyInput = ref('')
const securityTokenInput = ref('')
const region = ref('')
const endpoint = ref('')
const bucket = ref('')
const keyPrefix = ref('')
const publicBaseUrl = ref('')
const isCustomDomain = ref(false)
const hasSecretKey = ref(false)
const hasSecurityToken = ref(false)

function applyData(data: TosConfigPublic) {
  enabled.value = data.enabled
  accessKeyId.value = data.accessKeyId
  region.value = data.region
  endpoint.value = data.endpoint
  bucket.value = data.bucket
  keyPrefix.value = data.keyPrefix
  publicBaseUrl.value = data.publicBaseUrl
  isCustomDomain.value = data.isCustomDomain
  hasSecretKey.value = data.hasSecretKey
  hasSecurityToken.value = data.hasSecurityToken
  secretKeyInput.value = ''
  securityTokenInput.value = ''
}

async function loadConfig() {
  loading.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<TosConfigResponse>('/api/tos/config')
    if (response.success) {
      applyData(response.data)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载 TOS 配置失败'
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  saving.value = true
  message.value = ''
  errorMessage.value = ''

  try {
    const body: Record<string, unknown> = {
      enabled: enabled.value,
      accessKeyId: accessKeyId.value,
      region: region.value,
      endpoint: endpoint.value,
      bucket: bucket.value,
      keyPrefix: keyPrefix.value,
      publicBaseUrl: publicBaseUrl.value,
      isCustomDomain: isCustomDomain.value
    }

    if (secretKeyInput.value || !hasSecretKey.value) {
      body.secretKey = secretKeyInput.value
    }
    if (securityTokenInput.value || !hasSecurityToken.value) {
      body.securityToken = securityTokenInput.value
    }

    const response = await $fetch<TosConfigResponse>('/api/tos/config', {
      method: 'PUT',
      body
    })

    if (response.success) {
      applyData(response.data)
      message.value = '已保存 TOS 配置'
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存 TOS 配置失败'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void loadConfig()
})
</script>

<template>
  <div class="h-full overflow-y-auto p-6">
    <div class="mx-auto max-w-3xl space-y-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold">
          TOS 云存储
        </h2>
        <p class="text-sm text-muted-foreground">
          配置火山引擎 TOS 对象存储。未启用时，生成的媒体文件将保存在本地。
        </p>
      </div>

      <div
        v-if="loading"
        class="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 class="h-4 w-4 animate-spin" />
        加载中...
      </div>

      <template v-else>
        <div class="flex items-center justify-between rounded-lg border bg-background p-4">
          <div>
            <h3 class="text-sm font-medium">
              启用 TOS 云存储
            </h3>
            <p class="mt-1 text-xs text-muted-foreground">
              需填写完整的 Access Key、Secret Key、Region、Endpoint、Bucket。
            </p>
          </div>
          <Switch
            :checked="enabled"
            :disabled="saving"
            @update:checked="(value) => { enabled = value === true }"
          />
        </div>

        <div class="grid grid-cols-1 gap-3 rounded-lg border bg-background p-4 md:grid-cols-2">
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">Access Key ID</label>
            <Input
              v-model="accessKeyId"
              class="h-9 text-sm"
              placeholder="AKxxxxxxxx"
            />
          </div>

          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <label class="text-xs text-muted-foreground">Secret Key</label>
              <span
                class="inline-flex items-center gap-1 text-[11px]"
                :class="hasSecretKey ? 'text-emerald-600' : 'text-muted-foreground'"
              >
                <component
                  :is="hasSecretKey ? Check : X"
                  class="h-3 w-3"
                />
                {{ hasSecretKey ? '已保存' : '未保存' }}
              </span>
            </div>
            <Input
              v-model="secretKeyInput"
              class="h-9 text-sm"
              type="password"
              :placeholder="hasSecretKey ? '留空则继续使用已保存值' : '请输入 Secret Key'"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">Region</label>
            <Input
              v-model="region"
              class="h-9 text-sm"
              placeholder="cn-guangzhou"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">Endpoint</label>
            <Input
              v-model="endpoint"
              class="h-9 text-sm"
              placeholder="tos-cn-guangzhou.volces.com"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">Bucket</label>
            <Input
              v-model="bucket"
              class="h-9 text-sm"
              placeholder="my-bucket"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">Key Prefix（可选）</label>
            <Input
              v-model="keyPrefix"
              class="h-9 text-sm"
              placeholder="playlet-assets"
            />
          </div>

          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <label class="text-xs text-muted-foreground">Security Token（可选）</label>
              <span
                class="inline-flex items-center gap-1 text-[11px]"
                :class="hasSecurityToken ? 'text-emerald-600' : 'text-muted-foreground'"
              >
                <component
                  :is="hasSecurityToken ? Check : X"
                  class="h-3 w-3"
                />
                {{ hasSecurityToken ? '已保存' : '未保存' }}
              </span>
            </div>
            <Input
              v-model="securityTokenInput"
              class="h-9 text-sm"
              type="password"
              :placeholder="hasSecurityToken ? '留空则继续使用已保存值' : 'STS 临时令牌（可选）'"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">Public Base URL（可选）</label>
            <Input
              v-model="publicBaseUrl"
              class="h-9 text-sm"
              placeholder="https://cdn.example.com"
            />
          </div>
        </div>

        <div class="flex items-center justify-between rounded-lg border bg-background p-4">
          <div>
            <h3 class="text-sm font-medium">
              自定义域名
            </h3>
            <p class="mt-1 text-xs text-muted-foreground">
              当 Endpoint 为自定义加速域名时开启，公链将直接使用 Endpoint。
            </p>
          </div>
          <Switch
            :checked="isCustomDomain"
            :disabled="saving"
            @update:checked="(value) => { isCustomDomain = value === true }"
          />
        </div>

        <div class="flex items-center justify-between gap-3">
          <p
            v-if="message || errorMessage"
            class="text-xs"
            :class="errorMessage ? 'text-destructive' : 'text-emerald-600'"
          >
            {{ errorMessage || message }}
          </p>
          <span v-else />

          <Button
            size="sm"
            class="h-8 gap-1.5"
            :disabled="saving"
            @click="saveConfig"
          >
            <Loader2
              v-if="saving"
              class="h-3.5 w-3.5 animate-spin"
            />
            <Save
              v-else
              class="h-3.5 w-3.5"
            />
            保存
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>
