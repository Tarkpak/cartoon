<script setup lang="ts">
import {
  CheckCheck,
  CheckCircle2,
  Database,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
  XCircle
} from 'lucide-vue-next'
import SettingsCustomOpenAIProvider from '@/components/settings/SettingsCustomOpenAIProvider.vue'
import SettingsProviderCredentials from '@/components/settings/SettingsProviderCredentials.vue'
import SettingsProviderLogo from '@/components/settings/SettingsProviderLogo.vue'
import SettingsConfirmDialog from '@/components/settings/SettingsConfirmDialog.vue'
import { useSettingsModelCatalog } from '@/composables/useSettingsModelCatalog'
import {
  downloadSettingsConfigExport,
  parseSettingsConfigImportFile
} from '@/lib/settings-config-transfer'

type ProviderId = 'gemini' | 'qwen' | 'kling' | 'volcengine' | 'deepseek' | 'custom_openai'

interface ModelProviderCatalogEntry {
  model: string
  kind: string
  category: string
  displayName?: string
  description?: string
  docUrl?: string
  capabilities?: string[]
}

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
  availableModelCatalog?: ModelProviderCatalogEntry[]
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

interface SettingsConfigTransferResponse {
  success: boolean
  data: unknown
}

type ModelCategoryKey = 'text' | 'image' | 'video' | 'voice' | 'three_d' | 'other'

interface ModelCategoryGroup {
  key: ModelCategoryKey
  label: string
  description: string
  models: string[]
}

const MODEL_CATEGORY_ORDER: ModelCategoryKey[] = ['text', 'image', 'video', 'voice', 'three_d', 'other']
const MODEL_CATEGORY_META: Record<ModelCategoryKey, { label: string, description: string }> = {
  text: { label: '文本模型', description: '用于脚本解析、改写、对话生成等。' },
  image: { label: '图片模型', description: '用于角色图、环境图、参考图生成。' },
  video: { label: '视频模型', description: '用于文生视频、图生视频、视频编辑。' },
  voice: { label: '语音模型', description: '用于 TTS / ASR 语音任务。' },
  three_d: { label: '3D模型', description: '用于文生3D、图生3D及3D资产生成。' },
  other: { label: '其他模型', description: '未能自动识别类型的模型。' }
}

const syncingProvider = ref<ProviderId | null>(null)
const savingProvider = ref<ProviderId | null>(null)
const providersLoading = ref(false)
const providers = ref<ModelProviderSummary[]>([])
const enabledModelsByProvider = ref<Partial<Record<ProviderId, string[]>>>({})
const errorMessage = ref('')
const providerConfigMessage = ref('')
const activeProvider = ref<ProviderId | null>(null)
const modelSearchKeyword = ref('')
const providerConfigImporting = ref(false)
const providerConfigExporting = ref(false)
const providerConfigReloadToken = ref(0)
const providerConfigImportInputRef = ref<{ click: () => void } | null>(null)
const { loadModels } = useSettingsModelCatalog()

const activeProviderSummary = computed(() => {
  return providers.value.find(provider => provider.provider === activeProvider.value) || providers.value[0] || null
})

type CredentialProvider = 'gemini' | 'qwen' | 'volcengine' | 'deepseek' | 'kling'

const activeCredentialProvider = computed<CredentialProvider | null>(() => {
  const provider = activeProviderSummary.value?.provider
  if (!provider || provider === 'custom_openai') return null
  return provider
})

async function loadProviders() {
  providersLoading.value = true
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
    } else {
      errorMessage.value = '加载模型供应商失败'
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载模型供应商失败'
  } finally {
    providersLoading.value = false
  }
}

function retryLoadProviders() {
  void loadProviders()
}

function triggerProviderConfigImport() {
  providerConfigImportInputRef.value?.click()
}

async function handleProviderConfigImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  providerConfigImporting.value = true
  providerConfigMessage.value = ''
  errorMessage.value = ''

  try {
    const payload = await parseSettingsConfigImportFile(file)
    const response = await $fetch<SettingsConfigTransferResponse>('/api/model-providers/config/import', {
      method: 'POST',
      body: { payload }
    })

    if (response.success) {
      providerConfigReloadToken.value += 1
      providerConfigMessage.value = '已导入供应商配置'
      await loadProviders()
      await refreshModelCatalog()
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '导入供应商配置失败'
  } finally {
    providerConfigImporting.value = false
    input.value = ''
  }
}

async function exportProviderConfig() {
  providerConfigExporting.value = true
  providerConfigMessage.value = ''
  errorMessage.value = ''

  try {
    const response = await $fetch<SettingsConfigTransferResponse>('/api/model-providers/config/export')
    if (response.success) {
      downloadSettingsConfigExport(response.data, 'model-providers')
      providerConfigMessage.value = '已导出供应商配置'
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '导出供应商配置失败'
  } finally {
    providerConfigExporting.value = false
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

function normalizeModelList(models: string[]): string[] {
  const output: string[] = []
  const seen = new Set<string>()
  for (const model of models) {
    const normalized = model.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }
  return output
}

function isModelListEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every(item => rightSet.has(item))
}

async function saveProviderModels(provider: ProviderId, models: string[]) {
  const previous = [...(enabledModelsByProvider.value[provider] || [])]
  const nextModels = normalizeModelList(models)
  if (isModelListEqual(previous, nextModels)) {
    return
  }

  enabledModelsByProvider.value = {
    ...enabledModelsByProvider.value,
    [provider]: nextModels
  }
  savingProvider.value = provider
  errorMessage.value = ''

  try {
    if (provider === 'custom_openai') {
      const response = await $fetch<{ success: boolean }>('/api/models/custom-openai', {
        method: 'PUT',
        body: {
          textModels: nextModels
        }
      })

      if (response.success) {
        await loadProviders()
        await refreshModelCatalog()
      }
    } else {
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

async function updateModelEnabled(provider: ProviderId, model: string, value: unknown) {
  const previous = enabledModelsByProvider.value[provider] || []
  const current = new Set(previous)
  if (value === true) {
    current.add(model)
  } else {
    current.delete(model)
  }
  await saveProviderModels(provider, Array.from(current))
}

function updateActiveProviderModel(model: string, value: boolean | 'indeterminate') {
  if (!activeProviderSummary.value) return
  void updateModelEnabled(activeProviderSummary.value.provider, model, value)
}

const activeProviderAvailableModels = computed(() => {
  if (!activeProviderSummary.value) return []
  return availableModelsFor(activeProviderSummary.value)
})

const activeProviderEnabledModels = computed(() => {
  if (!activeProviderSummary.value) return []
  return enabledModelsByProvider.value[activeProviderSummary.value.provider] || []
})

const activeProviderHasEnabledModels = computed(() => {
  return activeProviderEnabledModels.value.length > 0
})

const activeProviderAllModelsSelected = computed(() => {
  const available = activeProviderAvailableModels.value
  const enabled = activeProviderEnabledModels.value
  if (available.length === 0) return false
  return isModelListEqual(available, enabled)
})

async function selectAllModelsForActiveProvider() {
  if (!activeProviderSummary.value) return
  await saveProviderModels(
    activeProviderSummary.value.provider,
    activeProviderAvailableModels.value
  )
}

const SELECT_ALL_CONFIRM_THRESHOLD = 50
const selectAllConfirmOpen = ref(false)

const selectAllConfirmDescription = computed(() => {
  return `当前供应商共有 ${activeProviderAvailableModels.value.length} 个可用模型，确定全部启用吗？启用过多模型会让「模型分配」里的下拉列表变得冗长。`
})

function handleSelectAllClick() {
  if (activeProviderAvailableModels.value.length > SELECT_ALL_CONFIRM_THRESHOLD) {
    selectAllConfirmOpen.value = true
    return
  }
  void selectAllModelsForActiveProvider()
}

async function confirmSelectAllModels() {
  selectAllConfirmOpen.value = false
  await selectAllModelsForActiveProvider()
}

async function clearModelsForActiveProvider() {
  if (!activeProviderSummary.value) return
  await saveProviderModels(activeProviderSummary.value.provider, [])
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

function normalizeModelCategoryKey(value: unknown): ModelCategoryKey {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'text') return 'text'
  if (normalized === 'image') return 'image'
  if (normalized === 'video') return 'video'
  if (normalized === 'voice') return 'voice'
  if (normalized === 'three_d') return 'three_d'
  return 'other'
}

function buildProviderCategoryMap(provider: ModelProviderSummary): Map<string, ModelCategoryKey> {
  const map = new Map<string, ModelCategoryKey>()
  for (const entry of provider.availableModelCatalog || []) {
    const model = (entry.model || '').trim()
    if (!model) continue
    map.set(model, normalizeModelCategoryKey(entry.category))
  }
  return map
}

const activeProviderModelGroups = computed<ModelCategoryGroup[]>(() => {
  if (!activeProviderSummary.value) return []

  const keyword = modelSearchKeyword.value.trim().toLowerCase()
  const groups: Record<ModelCategoryKey, string[]> = {
    text: [],
    image: [],
    video: [],
    voice: [],
    three_d: [],
    other: []
  }
  const categoryMap = buildProviderCategoryMap(activeProviderSummary.value)

  for (const model of availableModelsFor(activeProviderSummary.value)) {
    if (keyword && !model.toLowerCase().includes(keyword)) {
      continue
    }

    const category = categoryMap.get(model) || 'other'
    groups[category].push(model)
  }

  return MODEL_CATEGORY_ORDER
    .map((key) => ({
      key,
      label: MODEL_CATEGORY_META[key].label,
      description: MODEL_CATEGORY_META[key].description,
      models: groups[key].sort((a, b) => a.localeCompare(b))
    }))
    .filter(group => group.models.length > 0)
})

const activeProviderFilteredModelCount = computed(() => {
  return activeProviderModelGroups.value.reduce((sum, group) => sum + group.models.length, 0)
})

function selectProvider(provider: ProviderId) {
  activeProvider.value = provider
}

watch(activeProvider, () => {
  modelSearchKeyword.value = ''
})

onMounted(() => {
  void loadProviders()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden xl:flex-row">
    <Input
      ref="providerConfigImportInputRef"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="handleProviderConfigImport"
    />

    <div class="flex max-h-[36vh] w-full shrink-0 flex-col border-b bg-muted/30 xl:max-h-none xl:w-60 xl:border-b-0 xl:border-r">
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
          v-if="providersLoading && providers.length === 0"
          class="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground"
        >
          <Loader2 class="h-4 w-4 animate-spin" />
          加载供应商...
        </div>

        <Button
          v-for="provider in providers"
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
            class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-background"
            :class="provider.provider === activeProviderSummary?.provider ? 'border-primary/40' : 'border-border'"
          >
            <SettingsProviderLogo
              :provider="provider.provider"
              size-class="h-5 w-5"
            />
            <span
              class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background"
              :class="provider.configured ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
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

    <div class="@container flex flex-1 flex-col overflow-hidden">
      <div
        v-if="activeProviderSummary"
        class="border-b px-6 py-4"
      >
        <div class="flex flex-col gap-4 @2xl:flex-row @2xl:items-start @2xl:justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <div class="flex h-7 w-7 items-center justify-center rounded-md border bg-background">
                <SettingsProviderLogo
                  :provider="activeProviderSummary.provider"
                  size-class="h-4 w-4"
                />
              </div>
              <h2 class="text-lg font-semibold">
                {{ activeProviderSummary.displayName }}
              </h2>

              <span
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
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
                class="rounded px-1.5 py-0.5 text-xs"
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

          <div class="flex flex-wrap items-center gap-2 @2xl:justify-end">
            <Button
              variant="outline"
              size="sm"
              class="h-8 gap-1.5"
              :disabled="providersLoading || providerConfigImporting || providerConfigExporting"
              title="导入供应商配置"
              @click="triggerProviderConfigImport"
            >
              <Loader2
                v-if="providerConfigImporting"
                class="h-3.5 w-3.5 animate-spin"
              />
              <Upload
                v-else
                class="h-3.5 w-3.5"
              />
              导入配置
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-8 gap-1.5"
              :disabled="providersLoading || providerConfigImporting || providerConfigExporting"
              title="导出供应商配置"
              @click="exportProviderConfig"
            >
              <Loader2
                v-if="providerConfigExporting"
                class="h-3.5 w-3.5 animate-spin"
              />
              <Download
                v-else
                class="h-3.5 w-3.5"
              />
              导出配置
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-8 gap-1.5"
              :disabled="!activeProviderHasEnabledModels || savingProvider !== null || syncingProvider !== null"
              @click="clearModelsForActiveProvider"
            >
              <Trash2 class="h-3.5 w-3.5" />
              一键清除
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-8 gap-1.5"
              :disabled="activeProviderAvailableModels.length === 0 || activeProviderAllModelsSelected || savingProvider !== null || syncingProvider !== null"
              @click="handleSelectAllClick"
            >
              <CheckCheck class="h-3.5 w-3.5" />
              全选模型
            </Button>
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
        v-if="activeProviderSummary"
        class="flex-1 overflow-y-auto p-6"
      >
        <div class="mx-auto max-w-5xl space-y-4">
          <SettingsCustomOpenAIProvider
            v-if="activeProviderSummary.provider === 'custom_openai'"
            :key="`custom_openai_${providerConfigReloadToken}`"
            :on-saved="handleCustomProviderSaved"
          />
          <SettingsProviderCredentials
            v-else-if="activeCredentialProvider"
            :key="`${activeCredentialProvider}_${providerConfigReloadToken}`"
            :provider="activeCredentialProvider"
            :on-saved="handleCustomProviderSaved"
          />

          <div
            v-if="providerConfigMessage"
            class="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-600"
          >
            <CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0" />
            {{ providerConfigMessage }}
          </div>

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
            <div class="flex flex-col gap-4 @2xl:flex-row @2xl:items-start @2xl:justify-between">
              <div class="min-w-0 flex-1">
                <div class="grid grid-cols-1 gap-2 text-xs text-muted-foreground @xl:grid-cols-3">
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
                  class="mt-3 break-words rounded bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                >
                  {{ previewModels(activeProviderSummary.models) }}
                </p>
                <div
                  v-else
                  class="mt-3 space-y-2"
                >
                  <div class="relative">
                    <Search class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      v-model="modelSearchKeyword"
                      class="h-8 pl-7 text-xs"
                      placeholder="搜索模型 ID..."
                    />
                  </div>

                  <div class="text-xs text-muted-foreground">
                    共 {{ availableModelsFor(activeProviderSummary).length }} 个模型，当前显示 {{ activeProviderFilteredModelCount }} 个
                  </div>

                  <div
                    v-if="activeProviderModelGroups.length === 0"
                    class="rounded border border-dashed bg-muted/20 px-3 py-4 text-xs text-muted-foreground"
                  >
                    未找到匹配模型，请调整搜索关键词。
                  </div>

                  <div
                    v-else
                    class="max-h-[60vh] space-y-3 overflow-y-auto rounded border bg-muted/20 p-2"
                  >
                    <section
                      v-for="group in activeProviderModelGroups"
                      :key="`${activeProviderSummary.provider}_${group.key}`"
                      class="rounded-md border bg-background/80 p-2"
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                          <h4 class="text-xs font-medium">
                            {{ group.label }}
                          </h4>
                          <p class="mt-0.5 text-xs text-muted-foreground">
                            {{ group.description }}
                          </p>
                        </div>
                        <span class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {{ group.models.length }} 个
                        </span>
                      </div>

                      <div class="mt-2 grid grid-cols-1 gap-1 @lg:grid-cols-2">
                        <label
                          v-for="model in group.models"
                          :key="`${activeProviderSummary.provider}_${group.key}_${model}`"
                          class="flex min-w-0 items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/60"
                        >
                          <Checkbox
                            :checked="isModelEnabled(activeProviderSummary.provider, model)"
                            :disabled="savingProvider === activeProviderSummary.provider || syncingProvider !== null"
                            @update:checked="(value: boolean | 'indeterminate') => updateActiveProviderModel(model, value)"
                          />
                          <span class="truncate">{{ model }}</span>
                        </label>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-else-if="errorMessage"
        class="flex flex-1 items-center justify-center p-6"
      >
        <div class="max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <div class="flex items-start gap-2">
            <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="font-medium">
                模型供应商加载失败
              </p>
              <p class="mt-1 break-words text-xs">
                {{ errorMessage }}
              </p>
              <Button
                variant="outline"
                size="sm"
                class="mt-3 h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                :disabled="providersLoading"
                @click="retryLoadProviders"
              >
                <Loader2
                  v-if="providersLoading"
                  class="mr-1.5 h-3.5 w-3.5 animate-spin"
                />
                重试
              </Button>
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

    <SettingsConfirmDialog
      v-model:open="selectAllConfirmOpen"
      title="全选模型"
      :description="selectAllConfirmDescription"
      confirm-text="全部启用"
      confirm-variant="default"
      :busy="savingProvider !== null"
      @confirm="confirmSelectAllModels"
    />
  </div>
</template>
