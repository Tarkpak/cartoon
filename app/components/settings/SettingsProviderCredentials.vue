<script setup lang="ts">
import { Check, Loader2, Save, X } from 'lucide-vue-next'
import type { ProviderCredentialsPublic } from '#shared/types/provider'

type CredentialProvider = 'gemini' | 'qwen' | 'volcengine' | 'deepseek' | 'kling'

const props = defineProps<{
  provider: CredentialProvider
  onSaved: () => Promise<void> | void
}>()

interface ProviderCredentialsResponse {
  success: boolean
  data: ProviderCredentialsPublic
}

const PROVIDER_BASE_URL_PLACEHOLDER: Record<CredentialProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
  deepseek: 'https://api.deepseek.com',
  kling: 'https://api-beijing.klingai.com'
}

const loading = ref(false)
const saving = ref(false)
const message = ref('')
const errorMessage = ref('')

const baseUrl = ref('')
const apiKeyInput = ref('')
const accessKeyInput = ref('')
const secretKeyInput = ref('')
const hasApiKey = ref(false)
const hasAccessKey = ref(false)
const hasSecretKey = ref(false)

const isKling = computed(() => props.provider === 'kling')
const isGemini = computed(() => props.provider === 'gemini')

function applyData(data: ProviderCredentialsPublic) {
  const entry = data[props.provider]
  baseUrl.value = entry?.baseUrl || ''
  apiKeyInput.value = ''
  accessKeyInput.value = ''
  secretKeyInput.value = ''
  if (props.provider === 'kling') {
    hasAccessKey.value = (entry as ProviderCredentialsPublic['kling'])?.hasAccessKey ?? false
    hasSecretKey.value = (entry as ProviderCredentialsPublic['kling'])?.hasSecretKey ?? false
  } else {
    hasApiKey.value = (entry as ProviderCredentialsPublic['gemini'])?.hasApiKey ?? false
  }
}

async function loadConfig() {
  loading.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<ProviderCredentialsResponse>('/api/model-providers/credentials')
    if (response.success) {
      applyData(response.data)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载供应商凭证失败'
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
      baseUrl: baseUrl.value
    }

    if (isKling.value) {
      if (accessKeyInput.value || !hasAccessKey.value) {
        body.accessKey = accessKeyInput.value
      }
      if (secretKeyInput.value || !hasSecretKey.value) {
        body.secretKey = secretKeyInput.value
      }
    } else if (apiKeyInput.value || !hasApiKey.value) {
      body.apiKey = apiKeyInput.value
    }

    const response = await $fetch<ProviderCredentialsResponse>(
      `/api/model-providers/${props.provider}/credentials`,
      {
        method: 'PUT',
        body
      }
    )

    if (response.success) {
      applyData(response.data)
      message.value = '已保存供应商凭证'
      await props.onSaved()
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存供应商凭证失败'
  } finally {
    saving.value = false
  }
}

watch(() => props.provider, () => {
  void loadConfig()
})

onMounted(() => {
  void loadConfig()
})
</script>

<template>
  <div class="space-y-3 rounded-lg border bg-background p-4">
    <div>
      <h3 class="text-sm font-medium">
        供应商凭证
      </h3>
      <p class="mt-1 text-xs text-muted-foreground">
        在此填写密钥与接口地址，配置保存在本地数据库，不再依赖环境变量。
      </p>
    </div>

    <div
      v-if="loading"
      class="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <Loader2 class="h-3.5 w-3.5 animate-spin" />
      加载中...
    </div>

    <template v-else>
      <template v-if="isKling">
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-xs text-muted-foreground">Access Key</label>
            <span
              class="inline-flex items-center gap-1 text-[11px]"
              :class="hasAccessKey ? 'text-emerald-600' : 'text-muted-foreground'"
            >
              <component
                :is="hasAccessKey ? Check : X"
                class="h-3 w-3"
              />
              {{ hasAccessKey ? '已保存' : '未保存' }}
            </span>
          </div>
          <Input
            v-model="accessKeyInput"
            class="h-9 text-sm"
            type="password"
            :placeholder="hasAccessKey ? '留空则继续使用已保存值' : '请输入 Access Key'"
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
      </template>

      <div
        v-else
        class="space-y-1.5"
      >
        <div class="flex items-center justify-between">
          <label class="text-xs text-muted-foreground">API Key</label>
          <span
            class="inline-flex items-center gap-1 text-[11px]"
            :class="hasApiKey ? 'text-emerald-600' : 'text-muted-foreground'"
          >
            <component
              :is="hasApiKey ? Check : X"
              class="h-3 w-3"
            />
            {{ hasApiKey ? '已保存' : '未保存' }}
          </span>
        </div>
        <Input
          v-model="apiKeyInput"
          class="h-9 text-sm"
          type="password"
          :placeholder="hasApiKey ? '留空则继续使用已保存密钥' : '请输入 API Key'"
        />
        <p
          v-if="isGemini"
          class="text-[11px] text-muted-foreground"
        >
          支持多个密钥轮换，用英文逗号、分号或换行分隔。
        </p>
      </div>

      <div class="space-y-1.5">
        <label class="text-xs text-muted-foreground">Base URL（可选）</label>
        <Input
          v-model="baseUrl"
          class="h-9 text-sm"
          :placeholder="PROVIDER_BASE_URL_PLACEHOLDER[props.provider]"
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
</template>
