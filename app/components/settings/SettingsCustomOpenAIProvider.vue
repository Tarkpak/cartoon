<script setup lang="ts">
import { Check, Loader2, Plus, RefreshCw, Save, Trash2, X } from 'lucide-vue-next'
import { useCloudAdmin } from '@/composables/useCloudAdmin'
import type {
  CustomOpenAIProviderEntryPublicConfig,
  CustomOpenAIProvidersPublicConfig
} from '#shared/types/provider'

const props = defineProps<{
  onSaved: () => Promise<void> | void
}>()

interface CustomOpenAIProvidersResponse {
  success: boolean
  data: CustomOpenAIProvidersPublicConfig
}

interface ProviderFormState {
  apiKeyInput: string
  textModelsInput: string
  message: string
  errorMessage: string
}

const loading = ref(false)
const savingProvider = ref<string | null>(null)
const syncingProvider = ref<string | null>(null)
const deletingProvider = ref<string | null>(null)
const creating = ref(false)
const errorMessage = ref('')
const { authenticated: cloudAuthenticated, loadStatus: loadCloudStatus } = useCloudAdmin()
const providers = ref<CustomOpenAIProviderEntryPublicConfig[]>([])
const forms = reactive<Record<string, ProviderFormState>>({})

function ensureForm(provider: CustomOpenAIProviderEntryPublicConfig) {
  if (!forms[provider.id]) {
    forms[provider.id] = {
      apiKeyInput: '',
      textModelsInput: provider.textModels.join('\n'),
      message: '',
      errorMessage: ''
    }
    return
  }
}

function resetFormFromProvider(provider: CustomOpenAIProviderEntryPublicConfig) {
  ensureForm(provider)
  forms[provider.id].textModelsInput = provider.textModels.join('\n')
  forms[provider.id].apiKeyInput = ''
}

function syncForm(next: CustomOpenAIProvidersPublicConfig) {
  providers.value = next.providers
  for (const provider of next.providers) {
    resetFormFromProvider(provider)
  }
}

function parseTextModels(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n,，]/)
      .map(item => item.trim())
      .filter(Boolean)
  ))
}

function providerForm(provider: CustomOpenAIProviderEntryPublicConfig): ProviderFormState {
  ensureForm(provider)
  return forms[provider.id]!
}

async function loadConfig() {
  loading.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<CustomOpenAIProvidersResponse>('/api/models/custom-openai')
    if (response.success) {
      syncForm(response.data)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载自定义供应商失败'
  } finally {
    loading.value = false
  }
}

function buildProviderBody(provider: CustomOpenAIProviderEntryPublicConfig): Record<string, unknown> {
  const form = providerForm(provider)
  const body: Record<string, unknown> = {
    enabled: provider.enabled,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    textModels: parseTextModels(form.textModelsInput)
  }

  if (form.apiKeyInput || !provider.hasApiKey) {
    body.apiKey = form.apiKeyInput
  }

  return body
}

async function saveConfig(provider: CustomOpenAIProviderEntryPublicConfig) {
  const form = providerForm(provider)
  savingProvider.value = provider.id
  form.message = ''
  form.errorMessage = ''

  try {
    const response = await $fetch<CustomOpenAIProvidersResponse>(
      `/api/models/custom-openai/${provider.id}`,
      {
        method: 'PUT',
        body: buildProviderBody(provider)
      }
    )

    if (response.success) {
      syncForm(response.data)
      providerForm(provider).message = '已保存'
      await props.onSaved()
    }
  } catch (error) {
    form.errorMessage = error instanceof Error ? error.message : '保存自定义供应商失败'
  } finally {
    savingProvider.value = null
  }
}

async function createProvider() {
  creating.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<CustomOpenAIProvidersResponse>('/api/models/custom-openai', {
      method: 'POST',
      body: {
        enabled: false,
        displayName: `自定义 OpenAI ${providers.value.length + 1}`,
        baseUrl: '',
        apiKey: '',
        textModels: []
      }
    })
    if (response.success) {
      syncForm(response.data)
      await props.onSaved()
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '新增自定义供应商失败'
  } finally {
    creating.value = false
  }
}

async function deleteProvider(provider: CustomOpenAIProviderEntryPublicConfig) {
  deletingProvider.value = provider.id
  const form = providerForm(provider)
  form.message = ''
  form.errorMessage = ''

  try {
    const response = await $fetch<CustomOpenAIProvidersResponse>(
      `/api/models/custom-openai/${provider.id}`,
      { method: 'DELETE' }
    )
    if (response.success) {
      delete forms[provider.id]
      syncForm(response.data)
      await props.onSaved()
    }
  } catch (error) {
    form.errorMessage = error instanceof Error ? error.message : '删除自定义供应商失败'
  } finally {
    deletingProvider.value = null
  }
}

async function syncProvider(provider: CustomOpenAIProviderEntryPublicConfig) {
  syncingProvider.value = provider.id
  const form = providerForm(provider)
  form.message = ''
  form.errorMessage = ''

  try {
    const response = await $fetch<CustomOpenAIProvidersResponse>(
      `/api/models/custom-openai/${provider.id}/sync`,
      { method: 'POST' }
    )
    if (response.success) {
      syncForm(response.data)
      providerForm(provider).message = '已同步'
      await props.onSaved()
    }
  } catch (error) {
    form.errorMessage = error instanceof Error ? error.message : '同步模型失败'
    await loadConfig()
    await props.onSaved()
  } finally {
    syncingProvider.value = null
  }
}

function syncedAtLabel(provider: CustomOpenAIProviderEntryPublicConfig): string {
  if (!provider.modelsSyncedAt) return ''
  const date = new Date(provider.modelsSyncedAt)
  if (Number.isNaN(date.getTime())) return provider.modelsSyncedAt
  return date.toLocaleString()
}

onMounted(() => {
  void loadCloudStatus()
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
          可配置多个 OpenAI 兼容接口；模型运行时会按已启用/已同步的模型 ID 路由到对应 Base URL 与 Key。
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        class="h-8 gap-1.5"
        :disabled="creating || loading || cloudAuthenticated"
        @click="createProvider"
      >
        <Loader2
          v-if="creating"
          class="h-3.5 w-3.5 animate-spin"
        />
        <Plus
          v-else
          class="h-3.5 w-3.5"
        />
        新增
      </Button>
    </div>

    <div
      v-if="loading"
      class="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <Loader2 class="h-3.5 w-3.5 animate-spin" />
      加载中...
    </div>

    <p
      v-else-if="errorMessage"
      class="text-xs text-destructive"
    >
      {{ errorMessage }}
    </p>

    <div
      v-else
      class="space-y-3"
    >
      <section
        v-for="provider in providers"
        :key="provider.id"
        class="space-y-3 rounded-md border bg-muted/20 p-3"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="truncate text-sm font-medium">
                {{ provider.displayName }}
              </h4>
              <span
                class="inline-flex items-center gap-1 text-xs"
                :class="provider.hasApiKey ? 'text-emerald-600' : 'text-muted-foreground'"
              >
                <component
                  :is="provider.hasApiKey ? Check : X"
                  class="h-3 w-3"
                />
                {{ provider.hasApiKey ? '已保存 Key' : '未保存 Key' }}
              </span>
            </div>
            <p class="mt-0.5 text-xs text-muted-foreground">
              已启用 {{ provider.textModels.length }} 个模型，已发现 {{ provider.availableTextModels.length }} 个模型
            </p>
          </div>
          <Switch
            :checked="provider.enabled"
            :disabled="loading || savingProvider === provider.id || cloudAuthenticated"
            @update:checked="(value) => { provider.enabled = value === true }"
          />
        </div>

        <div class="grid grid-cols-1 gap-3 @lg:grid-cols-2">
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">供应商名称</label>
            <Input
              v-model="provider.displayName"
              class="h-9 text-sm"
              placeholder="自定义 OpenAI"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">Base URL</label>
            <Input
              v-model="provider.baseUrl"
              class="h-9 text-sm"
              :disabled="cloudAuthenticated"
              placeholder="https://api.example.com/v1"
            />
          </div>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">API Key</label>
          <Input
            v-model="providerForm(provider).apiKeyInput"
            class="h-9 text-sm"
            type="password"
            :disabled="cloudAuthenticated"
            :placeholder="provider.hasApiKey ? '留空则继续使用已保存密钥' : 'sk-...'"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">启用模型</label>
          <Textarea
            v-model="providerForm(provider).textModelsInput"
            class="min-h-20 text-sm"
            placeholder="gpt-4.1&#10;claude-sonnet-4-5"
          />
          <p class="text-xs text-muted-foreground">
            保存后可单独同步该供应商的 /models；模型 ID 尽量不要在多个自定义供应商中重复。
          </p>
          <p
            v-if="syncedAtLabel(provider)"
            class="text-xs text-muted-foreground"
          >
            上次同步：{{ syncedAtLabel(provider) }}
          </p>
          <p
            v-if="provider.modelsSyncError"
            class="text-xs text-amber-600"
          >
            上次同步失败：{{ provider.modelsSyncError }}
          </p>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <p
            v-if="providerForm(provider).message || providerForm(provider).errorMessage"
            class="text-xs"
            :class="providerForm(provider).errorMessage ? 'text-destructive' : 'text-emerald-600'"
          >
            {{ providerForm(provider).errorMessage || providerForm(provider).message }}
          </p>
          <span v-else />

          <div class="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              class="h-8 gap-1.5"
              :disabled="syncingProvider === provider.id || savingProvider !== null || cloudAuthenticated"
              @click="syncProvider(provider)"
            >
              <Loader2
                v-if="syncingProvider === provider.id"
                class="h-3.5 w-3.5 animate-spin"
              />
              <RefreshCw
                v-else
                class="h-3.5 w-3.5"
              />
              同步
            </Button>

            <Button
              size="sm"
              variant="outline"
              class="h-8 gap-1.5 text-destructive hover:text-destructive"
              :disabled="providers.length <= 1 || deletingProvider === provider.id || cloudAuthenticated"
              @click="deleteProvider(provider)"
            >
              <Loader2
                v-if="deletingProvider === provider.id"
                class="h-3.5 w-3.5 animate-spin"
              />
              <Trash2
                v-else
                class="h-3.5 w-3.5"
              />
              删除
            </Button>

            <Button
              size="sm"
              class="h-8 gap-1.5"
              :disabled="savingProvider === provider.id || cloudAuthenticated"
              @click="saveConfig(provider)"
            >
              <Loader2
                v-if="savingProvider === provider.id"
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
      </section>
    </div>
  </div>
</template>
