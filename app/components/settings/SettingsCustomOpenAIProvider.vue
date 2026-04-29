<script setup lang="ts">
import { Check, Loader2, RefreshCw, Save, X } from 'lucide-vue-next'
import type { CustomOpenAIProviderPublicConfig } from '#shared/types/provider'

const props = defineProps<{
  onSaved: () => Promise<void> | void
}>()

interface CustomOpenAIProviderResponse {
  success: boolean
  data: CustomOpenAIProviderPublicConfig
}

const loading = ref(false)
const saving = ref(false)
const syncing = ref(false)
const message = ref('')
const errorMessage = ref('')
const config = ref<CustomOpenAIProviderPublicConfig>({
  enabled: false,
  displayName: '自定义 OpenAI',
  baseUrl: '',
  textModels: [],
  availableTextModels: [],
  hasApiKey: false,
  modelsSyncedAt: undefined,
  modelsSyncError: undefined
})
const apiKeyInput = ref('')
const textModelsInput = ref('')

function syncForm(next: CustomOpenAIProviderPublicConfig) {
  config.value = next
  textModelsInput.value = next.textModels.join('\n')
  apiKeyInput.value = ''
}

function parseTextModels(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n,，]/)
      .map(item => item.trim())
      .filter(Boolean)
  ))
}

async function loadConfig() {
  loading.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<CustomOpenAIProviderResponse>('/api/models/custom-openai')
    if (response.success) {
      syncForm(response.data)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载自定义供应商失败'
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
      enabled: config.value.enabled,
      displayName: config.value.displayName,
      baseUrl: config.value.baseUrl,
      textModels: parseTextModels(textModelsInput.value)
    }

    if (apiKeyInput.value || !config.value.hasApiKey) {
      body.apiKey = apiKeyInput.value
    }

    const response = await $fetch<CustomOpenAIProviderResponse>('/api/models/custom-openai', {
      method: 'PUT',
      body
    })

    if (response.success) {
      syncForm(response.data)
      message.value = '已保存自定义供应商'
      await props.onSaved()
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存自定义供应商失败'
  } finally {
    saving.value = false
  }
}

async function syncModels() {
  syncing.value = true
  message.value = ''
  errorMessage.value = ''

  try {
    const body: Record<string, unknown> = {
      enabled: true,
      displayName: config.value.displayName,
      baseUrl: config.value.baseUrl
    }

    if (apiKeyInput.value || !config.value.hasApiKey) {
      body.apiKey = apiKeyInput.value
    }

    const response = await $fetch<CustomOpenAIProviderResponse>('/api/models/custom-openai/sync', {
      method: 'POST',
      body
    })

    if (response.success) {
      syncForm(response.data)
      message.value = `已同步 ${response.data.textModels.length} 个模型`
      await props.onSaved()
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '同步模型失败'
  } finally {
    syncing.value = false
  }
}

const syncedAtLabel = computed(() => {
  if (!config.value.modelsSyncedAt) return ''
  const date = new Date(config.value.modelsSyncedAt)
  if (Number.isNaN(date.getTime())) return config.value.modelsSyncedAt
  return date.toLocaleString()
})

onMounted(() => {
  void loadConfig()
})
</script>

<template>
  <div class="space-y-3 rounded-lg border bg-background p-4">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-sm font-medium">
          自定义 OpenAI 兼容供应商
        </h3>
        <p class="mt-1 text-xs text-muted-foreground">
          通过 OpenAI 兼容接口获取模型列表，并用于文本生成类流程。
        </p>
      </div>
      <Switch
        :checked="config.enabled"
        :disabled="loading || saving"
        @update:checked="(value) => { config.enabled = value === true }"
      />
    </div>

    <div
      v-if="loading"
      class="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <Loader2 class="h-3.5 w-3.5 animate-spin" />
      加载中...
    </div>

    <template v-else>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">供应商名称</label>
          <Input
            v-model="config.displayName"
            class="h-9 text-sm"
            placeholder="自定义 OpenAI"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">Base URL</label>
          <Input
            v-model="config.baseUrl"
            class="h-9 text-sm"
            placeholder="https://api.example.com/v1"
          />
        </div>
      </div>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-xs text-muted-foreground">API Key</label>
          <span
            class="inline-flex items-center gap-1 text-[11px]"
            :class="config.hasApiKey ? 'text-emerald-600' : 'text-muted-foreground'"
          >
            <component
              :is="config.hasApiKey ? Check : X"
              class="h-3 w-3"
            />
            {{ config.hasApiKey ? '已保存' : '未保存' }}
          </span>
        </div>
        <Input
          v-model="apiKeyInput"
          class="h-9 text-sm"
          type="password"
          :placeholder="config.hasApiKey ? '留空则继续使用已保存密钥' : 'sk-...'"
        />
      </div>

      <div class="space-y-1.5">
        <label class="text-xs text-muted-foreground">文本模型</label>
        <Textarea
          v-model="textModelsInput"
          class="min-h-20 text-sm"
          placeholder="gpt-4.1&#10;claude-sonnet-4-5"
        />
        <p class="text-[11px] text-muted-foreground">
          优先点击“同步模型”从供应商 /models 接口获取；也可以手动补充或修正模型 ID。
        </p>
        <p
          v-if="syncedAtLabel"
          class="text-[11px] text-muted-foreground"
        >
          上次同步：{{ syncedAtLabel }}
        </p>
        <p
          v-if="config.modelsSyncError"
          class="text-[11px] text-amber-600"
        >
          上次同步失败：{{ config.modelsSyncError }}
        </p>
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

        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="h-8 gap-1.5"
            :disabled="saving || syncing"
            @click="syncModels"
          >
            <Loader2
              v-if="syncing"
              class="h-3.5 w-3.5 animate-spin"
            />
            <RefreshCw
              v-else
              class="h-3.5 w-3.5"
            />
            同步模型
          </Button>

          <Button
            size="sm"
            class="h-8 gap-1.5"
            :disabled="saving || syncing"
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
      </div>
    </template>
  </div>
</template>
