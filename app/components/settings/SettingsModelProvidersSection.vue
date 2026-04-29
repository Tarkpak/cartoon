<script setup lang="ts">
import {
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  TriangleAlert,
  XCircle
} from 'lucide-vue-next'
import SettingsCustomOpenAIProvider from '@/components/settings/SettingsCustomOpenAIProvider.vue'
import { useSettingsModelCatalog } from '@/composables/useSettingsModelCatalog'

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

interface ModelProviderResponse {
  success: boolean
  data: ModelProviderSummary
}

const loading = ref(false)
const syncingProvider = ref<ProviderId | null>(null)
const savingProvider = ref<ProviderId | null>(null)
const providers = ref<ModelProviderSummary[]>([])
const enabledModelsByProvider = ref<Partial<Record<ProviderId, string[]>>>({})
const errorMessage = ref('')
const activeProvider = ref<ProviderId | null>(null)
const { loadModels } = useSettingsModelCatalog()

const activeProviderSummary = computed(() => {
  return providers.value.find(provider => provider.provider === activeProvider.value) || providers.value[0] || null
})

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

      if (
        response.data.providers.length > 0
        && !response.data.providers.some(provider => provider.provider === activeProvider.value)
      ) {
        activeProvider.value = response.data.providers[0]!.provider
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载模型供应商失败'
  } finally {
    loading.value = false
  }
}

async function refreshModelCatalog() {
  await loadModels(true)
}

async function handleCustomProviderSaved() {
  await loadProviders()
  await refreshModelCatalog()
}

function isModelEnabled(provider: ProviderId, model: string): boolean {
  return (enabledModelsByProvider.value[provider] || []).includes(model)
}

async function updateModelEnabled(provider: ProviderId, model: string, value: unknown) {
  const previous = enabledModelsByProvider.value[provider] || []
  const current = new Set(previous)
  if (value === true) {
    current.add(model)
  } else {
    current.delete(model)
  }
  const nextModels = Array.from(current)

  enabledModelsByProvider.value = {
    ...enabledModelsByProvider.value,
    [provider]: nextModels
  }
  savingProvider.value = provider
  errorMessage.value = ''

  try {
    const response = await $fetch<ModelProviderResponse>(`/api/model-providers/${provider}/models`, {
      method: 'PUT',
      body: {
        models: nextModels
      }
    })

    if (response.success) {
      providers.value = providers.value.map(item => item.provider === provider ? response.data : item)
      enabledModelsByProvider.value = {
        ...enabledModelsByProvider.value,
        [provider]: [...response.data.models]
      }
      await refreshModelCatalog()
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存可用模型失败'
    enabledModelsByProvider.value = {
      ...enabledModelsByProvider.value,
      [provider]: previous
    }
  } finally {
    savingProvider.value = null
  }
}

function updateActiveProviderModel(model: string, value: boolean | 'indeterminate') {
  if (!activeProviderSummary.value) return
  void updateModelEnabled(activeProviderSummary.value.provider, model, value)
}

async function syncProvider(provider: ProviderId) {
  syncingProvider.value = provider
  errorMessage.value = ''

  try {
    await $fetch(`/api/model-providers/${provider}/sync`, {
      method: 'POST'
    })
    await loadProviders()
    await refreshModelCatalog()
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
  return Array.from(new Set([...provider.availableModels, ...provider.models]))
}

function selectProvider(provider: ProviderId) {
  activeProvider.value = provider
}

onMounted(() => {
  void loadProviders()
})
</script>

<template>
  <div class="h-full flex overflow-hidden">
    <div class="flex w-64 shrink-0 flex-col border-r bg-muted/30">
      <div class="border-b px-4 py-4">
        <h2 class="text-base font-semibold">
          模型供应商
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          左侧切换供应商，右侧管理模型同步与启用状态。
        </p>
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        <div
          v-if="loading"
          class="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground"
        >
          <Loader2 class="h-4 w-4 animate-spin" />
          加载供应商...
        </div>

        <Button
          v-for="provider in providers"
          v-else
          :key="provider.provider"
          type="button"
          variant="ghost"
          class="h-auto w-full justify-start gap-3 rounded-xl px-3 py-3 text-left transition-colors"
          :class="provider.provider === activeProviderSummary?.provider
            ? 'bg-primary/10 text-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'"
          @click="selectProvider(provider.provider)"
        >
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border"
            :class="provider.configured
              ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-border bg-muted text-muted-foreground'"
          >
            <component
              :is="provider.configured ? CheckCircle2 : XCircle"
              class="h-4 w-4"
            />
          </div>

          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">
              {{ provider.displayName }}
            </div>
            <div class="mt-0.5 text-xs text-muted-foreground">
              {{ (enabledModelsByProvider[provider.provider] || []).length }} / {{ availableModelsFor(provider).length }} 个模型
            </div>
          </div>
        </Button>
      </div>
    </div>

    <div class="flex flex-1 flex-col overflow-hidden">
      <div
        v-if="activeProviderSummary"
        class="border-b px-6 py-4"
      >
        <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-lg font-semibold">
                {{ activeProviderSummary.displayName }}
              </h2>

              <span
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
                :class="activeProviderSummary.configured
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : 'bg-muted text-muted-foreground'"
              >
                <component
                  :is="activeProviderSummary.configured ? CheckCircle2 : XCircle"
                  class="h-3 w-3"
                />
                {{ activeProviderSummary.configured ? '已配置' : '未配置' }}
              </span>

              <span
                class="rounded px-1.5 py-0.5 text-[11px]"
                :class="activeProviderSummary.supportedDynamicSync
                  ? 'bg-blue-500/10 text-blue-600'
                  : 'bg-muted text-muted-foreground'"
              >
                {{ activeProviderSummary.supportedDynamicSync ? '官方 API 同步' : '本地能力表' }}
              </span>
            </div>

            <p class="mt-1 text-sm text-muted-foreground">
              {{ activeProviderSummary.description }}
            </p>
          </div>

          <div class="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
            <span
              v-if="savingProvider === activeProviderSummary.provider"
              class="inline-flex h-8 items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Loader2 class="h-3.5 w-3.5 animate-spin" />
              自动保存中
            </span>
            <Button
              variant="outline"
              size="sm"
              class="h-8 gap-1.5"
              :disabled="!activeProviderSummary.supportedDynamicSync || !activeProviderSummary.configured || savingProvider !== null || syncingProvider !== null"
              @click="syncProvider(activeProviderSummary.provider)"
            >
              <Loader2
                v-if="syncingProvider === activeProviderSummary.provider"
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

      <div
        v-if="loading"
        class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
      >
        <Loader2 class="mr-2 h-4 w-4 animate-spin" />
        加载供应商...
      </div>

      <div
        v-else-if="activeProviderSummary"
        class="flex-1 overflow-y-auto p-6"
      >
        <div class="mx-auto max-w-5xl space-y-4">
          <SettingsCustomOpenAIProvider
            v-if="activeProviderSummary.provider === 'custom_openai'"
            :on-saved="handleCustomProviderSaved"
          />

          <div
            v-if="errorMessage"
            class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
            {{ errorMessage }}
          </div>

          <div
            class="rounded-lg border bg-background p-4"
          >
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div class="min-w-0 flex-1">
                <div class="grid grid-cols-1 gap-2 text-xs text-muted-foreground md:grid-cols-3">
                  <div class="flex items-center gap-1.5">
                    <Database class="h-3.5 w-3.5" />
                    已启用 {{ (enabledModelsByProvider[activeProviderSummary.provider] || []).length }} / {{ availableModelsFor(activeProviderSummary).length }} 个模型
                  </div>
                  <div>同步时间：{{ formatSyncedAt(activeProviderSummary.syncedAt) }}</div>
                  <div
                    v-if="activeProviderSummary.syncError"
                    class="text-amber-600"
                  >
                    同步失败：{{ activeProviderSummary.syncError }}
                  </div>
                </div>

                <p
                  v-if="availableModelsFor(activeProviderSummary).length === 0"
                  class="mt-3 break-words rounded bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground"
                >
                  {{ previewModels(activeProviderSummary.models) }}
                </p>
                <div
                  v-else
                  class="mt-3 grid max-h-[60vh] grid-cols-1 gap-1 overflow-y-auto rounded border bg-muted/20 p-2 md:grid-cols-2"
                >
                  <label
                    v-for="model in availableModelsFor(activeProviderSummary)"
                    :key="`${activeProviderSummary.provider}_${model}`"
                    class="flex min-w-0 items-center gap-2 rounded px-2 py-1 text-xs hover:bg-background"
                  >
                    <Checkbox
                      :checked="isModelEnabled(activeProviderSummary.provider, model)"
                      :disabled="savingProvider === activeProviderSummary.provider || syncingProvider !== null"
                      @update:checked="(value: boolean | 'indeterminate') => updateActiveProviderModel(model, value)"
                    />
                    <span class="truncate">{{ model }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-else
        class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
      >
        暂无供应商
      </div>
    </div>
  </div>
</template>
