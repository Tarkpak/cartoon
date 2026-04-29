<script setup lang="ts">
import {
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  Save,
  TriangleAlert,
  XCircle
} from 'lucide-vue-next'
import SettingsCustomOpenAIProvider from '@/components/settings/SettingsCustomOpenAIProvider.vue'

type ProviderId = 'gemini' | 'qwen' | 'kling' | 'volcengine' | 'custom_openai'

interface ModelProviderSummary {
  provider: ProviderId
  displayName: string
  description: string
  syncMode: 'official_api' | 'manual'
  configured: boolean
  supportedDynamicSync: boolean
  syncedAt?: string
  syncError?: string
  modelCount: number
  models: string[]
  availableModels: string[]
}

interface ModelProvidersResponse {
  success: boolean
  data: {
    providers: ModelProviderSummary[]
  }
}

const loading = ref(false)
const syncingProvider = ref<ProviderId | null>(null)
const savingProvider = ref<ProviderId | null>(null)
const providers = ref<ModelProviderSummary[]>([])
const enabledModelsByProvider = ref<Partial<Record<ProviderId, string[]>>>({})
const errorMessage = ref('')

async function loadProviders() {
  loading.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<ModelProvidersResponse>('/api/model-providers')
    if (response.success) {
      providers.value = response.data.providers
      enabledModelsByProvider.value = Object.fromEntries(
        response.data.providers.map(provider => [provider.provider, [...provider.models]])
      ) as Partial<Record<ProviderId, string[]>>
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载模型供应商失败'
  } finally {
    loading.value = false
  }
}

function isModelEnabled(provider: ProviderId, model: string): boolean {
  return (enabledModelsByProvider.value[provider] || []).includes(model)
}

function toggleModel(provider: ProviderId, model: string, value: unknown) {
  const current = new Set(enabledModelsByProvider.value[provider] || [])
  if (value === true) {
    current.add(model)
  } else {
    current.delete(model)
  }
  enabledModelsByProvider.value = {
    ...enabledModelsByProvider.value,
    [provider]: Array.from(current)
  }
}

async function saveEnabledModels(provider: ProviderId) {
  savingProvider.value = provider
  errorMessage.value = ''

  try {
    await $fetch(`/api/model-providers/${provider}/models`, {
      method: 'PUT',
      body: {
        models: enabledModelsByProvider.value[provider] || []
      }
    })
    await loadProviders()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存可用模型失败'
  } finally {
    savingProvider.value = null
  }
}

async function syncProvider(provider: ProviderId) {
  syncingProvider.value = provider
  errorMessage.value = ''

  try {
    await $fetch(`/api/model-providers/${provider}/sync`, {
      method: 'POST'
    })
    await loadProviders()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '同步模型失败'
    await loadProviders()
  } finally {
    syncingProvider.value = null
  }
}

function formatSyncedAt(value?: string): string {
  if (!value) return '未同步'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function previewModels(models: string[]): string {
  if (models.length === 0) return '暂无模型'
  const head = models.slice(0, 8).join(', ')
  return models.length > 8 ? `${head} ...` : head
}

function availableModelsFor(provider: ModelProviderSummary): string[] {
  return provider.availableModels.length > 0 ? provider.availableModels : provider.models
}

onMounted(() => {
  void loadProviders()
})
</script>

<template>
  <div class="h-full overflow-y-auto p-6">
    <div class="mx-auto max-w-5xl space-y-4">
      <div>
        <h2 class="text-lg font-semibold">
          模型供应商
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          统一管理供应商配置，并通过官方 API 同步账号当前可用的模型。
        </p>
      </div>

      <SettingsCustomOpenAIProvider :on-saved="loadProviders" />

      <div
        v-if="errorMessage"
        class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
        {{ errorMessage }}
      </div>

      <div
        v-if="loading"
        class="flex items-center justify-center rounded-lg border bg-background p-8 text-sm text-muted-foreground"
      >
        <Loader2 class="mr-2 h-4 w-4 animate-spin" />
        加载供应商...
      </div>

      <div
        v-else
        class="grid grid-cols-1 gap-3"
      >
        <div
          v-for="provider in providers"
          :key="provider.provider"
          class="rounded-lg border bg-background p-4"
        >
          <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-sm font-medium">
                  {{ provider.displayName }}
                </h3>

                <span
                  class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
                  :class="provider.configured
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : 'bg-muted text-muted-foreground'"
                >
                  <component
                    :is="provider.configured ? CheckCircle2 : XCircle"
                    class="h-3 w-3"
                  />
                  {{ provider.configured ? '已配置' : '未配置' }}
                </span>

                <span
                  class="rounded px-1.5 py-0.5 text-[11px]"
                  :class="provider.supportedDynamicSync
                    ? 'bg-blue-500/10 text-blue-600'
                    : 'bg-muted text-muted-foreground'"
                >
                  {{ provider.supportedDynamicSync ? '官方 API 同步' : '本地能力表' }}
                </span>
              </div>

              <p class="mt-1 text-xs text-muted-foreground">
                {{ provider.description }}
              </p>

              <div class="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground md:grid-cols-3">
                <div class="flex items-center gap-1.5">
                  <Database class="h-3.5 w-3.5" />
                  已启用 {{ (enabledModelsByProvider[provider.provider] || []).length }} / {{ availableModelsFor(provider).length }} 个模型
                </div>
                <div>同步时间：{{ formatSyncedAt(provider.syncedAt) }}</div>
                <div
                  v-if="provider.syncError"
                  class="text-amber-600"
                >
                  同步失败：{{ provider.syncError }}
                </div>
              </div>

              <p
                v-if="availableModelsFor(provider).length === 0"
                class="mt-3 break-words rounded bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground"
              >
                {{ previewModels(provider.models) }}
              </p>
              <div
                v-else
                class="mt-3 grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded border bg-muted/20 p-2 md:grid-cols-2"
              >
                <label
                  v-for="model in availableModelsFor(provider)"
                  :key="`${provider.provider}_${model}`"
                  class="flex min-w-0 items-center gap-2 rounded px-2 py-1 text-xs hover:bg-background"
                >
                  <Checkbox
                    :checked="isModelEnabled(provider.provider, model)"
                    @update:checked="(value: boolean | 'indeterminate') => toggleModel(provider.provider, model, value)"
                  />
                  <span class="truncate">{{ model }}</span>
                </label>
              </div>
            </div>

            <div class="flex shrink-0 flex-wrap gap-2 md:justify-end">
              <Button
                variant="outline"
                size="sm"
                class="h-8 gap-1.5"
                :disabled="savingProvider !== null || syncingProvider !== null"
                @click="saveEnabledModels(provider.provider)"
              >
                <Loader2
                  v-if="savingProvider === provider.provider"
                  class="h-3.5 w-3.5 animate-spin"
                />
                <Save
                  v-else
                  class="h-3.5 w-3.5"
                />
                保存可用模型
              </Button>

              <Button
                variant="outline"
                size="sm"
                class="h-8 gap-1.5"
                :disabled="!provider.supportedDynamicSync || !provider.configured || savingProvider !== null || syncingProvider !== null"
                @click="syncProvider(provider.provider)"
              >
                <Loader2
                  v-if="syncingProvider === provider.provider"
                  class="h-3.5 w-3.5 animate-spin"
                />
                <RefreshCw
                  v-else
                  class="h-3.5 w-3.5"
                />
                同步模型
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
