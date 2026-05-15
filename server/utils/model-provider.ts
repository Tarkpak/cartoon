/**
 * 统一模型提供商管理器
 * 支持在不同 AI 服务商之间切换
 */

import type {
  ModelProvider,
  TextModelConfig,
  ImageModelConfig,
  VideoModelConfig,
  VoiceModelConfig,
  SelectedModels,
  CustomOpenAIProviderConfig,
  CustomOpenAIProviderPublicConfig
} from '../../shared/types/provider'
import { CustomOpenAIProviderConfigSchema } from '../../shared/types/provider'
import { eq } from 'drizzle-orm'
import { db, systemConfig } from '../db'

import * as gemini from './gemini'
import * as qwen from './qwen'
import * as kling from './kling'
import * as volcengine from './volcengine'
import {
  generateOpenAICompatibleJSON,
  generateOpenAICompatibleImage,
  generateOpenAICompatibleText,
  listOpenAICompatibleModels
} from './openai-compatible'

// 注意: GeminiError/GeminiErrorCode 请从 './gemini' 导入
// 注意: QwenError/QwenErrorCode 请从 './qwen' 导入

// ============================================================
// 可用模型配置
// ============================================================

/** 所有可用的文本模型 */
export const TEXT_MODELS: TextModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.TextModels.GENERAL,
    displayName: 'Gemini 3 Flash',
    description: '快速响应，适合通用任务',
    supportThinking: false,
    docUrl: 'https://ai.google.dev/gemini-api/docs'
  },
  {
    provider: 'gemini',
    model: gemini.TextModels.SCRIPT_PARSER,
    displayName: 'Gemini 3.1 Pro Preview',
    description: '高级推理能力，适合复杂剧本解析',
    supportThinking: false,
    docUrl: 'https://ai.google.dev/gemini-api/docs'
  },
  // 千问模型
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.QWEN_PLUS_THINKING,
    displayName: '通义千问3.6-Plus (深度思考)',
    description: '新一代高性能深度思考模型',
    supportThinking: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.QWEN3_MAX,
    displayName: '通义千问3-Max',
    description: '适配复杂场景，达到领域SOTA水平',
    supportThinking: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-api-reference'
  },
  // DeepSeek 官方模型
  {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    description: 'DeepSeek 官方旗舰模型，复杂推理与代码能力更强',
    supportThinking: true,
    docUrl: 'https://api-docs.deepseek.com/'
  },
  {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    description: 'DeepSeek 官方高性价比模型，速度更快、延迟更低',
    supportThinking: true,
    docUrl: 'https://api-docs.deepseek.com/'
  },
  // 火山引擎 (豆包) 模型
  {
    provider: 'volcengine',
    model: volcengine.VolcengineTextModels.DOUBAO_SEED_2_0_PRO,
    displayName: '豆包 Seed 2.0 Pro',
    description: '旗舰文本模型，复杂任务表现最强',
    supportThinking: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  },
  {
    provider: 'volcengine',
    model: volcengine.VolcengineTextModels.DEEPSEEK_V3_2,
    displayName: 'DeepSeek-V3.2 (火山)',
    description: 'DeepSeek最新版 (火山引擎)',
    supportThinking: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  }
]

const CUSTOM_OPENAI_CONFIG_KEY = 'custom_openai_provider'
const PROVIDER_MODEL_CATALOG_KEY = 'provider_model_catalog'
const QWEN_COMPATIBLE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const VOLCENGINE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

type SyncableProvider = 'gemini' | 'qwen' | 'kling' | 'volcengine' | 'deepseek' | 'custom_openai'

const PROVIDER_MODEL_PRIORITY: Record<ModelProvider, number> = {
  deepseek: 1,
  qwen: 2,
  volcengine: 3,
  gemini: 4,
  kling: 5,
  custom_openai: 90,
  openai: 91
}

interface ProviderSyncedCatalogEntry {
  models: string[]
  availableModels?: string[]
  syncedAt?: string
  syncError?: string
}

type ProviderSyncedCatalog = Partial<Record<SyncableProvider, ProviderSyncedCatalogEntry>>

export interface ModelProviderSummary {
  provider: SyncableProvider
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

const DEFAULT_CUSTOM_OPENAI_CONFIG: CustomOpenAIProviderConfig = {
  enabled: false,
  displayName: '自定义 OpenAI',
  baseUrl: '',
  apiKey: '',
  textModels: [],
  availableTextModels: [],
  modelsSyncedAt: undefined,
  modelsSyncError: undefined
}

let customOpenAIConfig: CustomOpenAIProviderConfig = { ...DEFAULT_CUSTOM_OPENAI_CONFIG }
let providerSyncedCatalog: ProviderSyncedCatalog = {}

async function readProviderModelCatalogFromDB(): Promise<ProviderSyncedCatalog> {
  const rows = await db.select()
    .from(systemConfig)
    .where(eq(systemConfig.key, PROVIDER_MODEL_CATALOG_KEY))
    .limit(1)

  const row = rows[0]
  if (!row?.value) return {}

  try {
    const parsed = JSON.parse(row.value) as ProviderSyncedCatalog
    const normalized: ProviderSyncedCatalog = {}
    for (const [provider, entry] of Object.entries(parsed) as Array<[SyncableProvider, ProviderSyncedCatalogEntry]>) {
      normalized[provider] = {
        models: Array.from(new Set((entry.models || []).map(model => normalizeModelId(model)).filter(Boolean))),
        availableModels: Array.from(new Set((entry.availableModels || entry.models || []).map(model => normalizeModelId(model)).filter(Boolean))),
        syncedAt: entry.syncedAt,
        syncError: entry.syncError
      }
    }
    return normalized
  } catch {
    return {}
  }
}

async function saveProviderModelCatalogToDB(catalog: ProviderSyncedCatalog): Promise<void> {
  const now = new Date().toISOString()
  await db.insert(systemConfig)
    .values({
      key: PROVIDER_MODEL_CATALOG_KEY,
      value: JSON.stringify(catalog),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: JSON.stringify(catalog),
        updatedAt: now
      }
    })
  providerSyncedCatalog = catalog
}

function getSyncedModelSet(provider: SyncableProvider): Set<string> | null {
  const entry = providerSyncedCatalog[provider]
  if (!entry || !Array.isArray(entry.models)) return null
  return new Set(entry.models.map(model => normalizeModelId(model)))
}

function filterModelsBySyncedCatalog<T extends { provider: string, model: string }>(models: T[]): T[] {
  return models.filter((model) => {
    const provider = model.provider as SyncableProvider
    if (provider === 'custom_openai') return true

    const synced = getSyncedModelSet(provider)
    if (!synced) return true
    return synced.has(normalizeModelId(model.model))
  })
}

function dedupeModelsByModelId<T extends { provider: ModelProvider, model: string }>(models: T[]): T[] {
  const selected = new Map<string, T>()

  for (const model of models) {
    const normalizedModelId = normalizeModelId(model.model)
    const existing = selected.get(normalizedModelId)

    if (!existing) {
      selected.set(normalizedModelId, model)
      continue
    }

    const existingPriority = PROVIDER_MODEL_PRIORITY[existing.provider] ?? 999
    const nextPriority = PROVIDER_MODEL_PRIORITY[model.provider] ?? 999
    if (nextPriority < existingPriority) {
      selected.set(normalizedModelId, model)
    }
  }

  return Array.from(selected.values())
}

function normalizeCustomOpenAIConfig(raw: unknown): CustomOpenAIProviderConfig {
  const parsed = CustomOpenAIProviderConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return { ...DEFAULT_CUSTOM_OPENAI_CONFIG }
  }

  return {
    ...parsed.data,
    textModels: Array.from(new Set(
      parsed.data.textModels
        .map(model => normalizeModelId(model))
        .filter(Boolean)
    )),
    availableTextModels: Array.from(new Set(
      (parsed.data.availableTextModels.length > 0 ? parsed.data.availableTextModels : parsed.data.textModels)
        .map(model => normalizeModelId(model))
        .filter(Boolean)
    ))
  }
}

async function readCustomOpenAIConfigFromDB(): Promise<CustomOpenAIProviderConfig> {
  const rows = await db.select()
    .from(systemConfig)
    .where(eq(systemConfig.key, CUSTOM_OPENAI_CONFIG_KEY))
    .limit(1)

  const row = rows[0]
  if (!row?.value) {
    return { ...DEFAULT_CUSTOM_OPENAI_CONFIG }
  }

  try {
    return normalizeCustomOpenAIConfig(JSON.parse(row.value))
  } catch {
    return { ...DEFAULT_CUSTOM_OPENAI_CONFIG }
  }
}

async function saveCustomOpenAIConfigToDB(config: CustomOpenAIProviderConfig): Promise<void> {
  const normalized = normalizeCustomOpenAIConfig(config)
  const now = new Date().toISOString()
  await db.insert(systemConfig)
    .values({
      key: CUSTOM_OPENAI_CONFIG_KEY,
      value: JSON.stringify(normalized),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: JSON.stringify(normalized),
        updatedAt: now
      }
    })
  customOpenAIConfig = normalized
}

function buildCustomOpenAITextModels(): TextModelConfig[] {
  if (!customOpenAIConfig.enabled) return []

  return customOpenAIConfig.textModels.map(model => ({
    provider: 'custom_openai',
    model,
    displayName: model,
    description: `${customOpenAIConfig.displayName} - OpenAI 兼容文本模型`,
    supportThinking: false
  }))
}

function isCustomOpenAIImageModel(model: string): boolean {
  return normalizeModelId(model).toLowerCase().includes('image')
}

function supportsOpenAIImageQuality(model: string): boolean {
  return normalizeModelId(model).toLowerCase().startsWith('gpt-image')
}

function supportsOpenAIImageEdit(model: string): boolean {
  return normalizeModelId(model).toLowerCase().startsWith('gpt-image')
}

const APIMART_GPT_IMAGE_2_ASPECT_RATIOS = [
  'auto',
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '5:4',
  '4:5',
  '16:9',
  '9:16',
  '2:1',
  '1:2',
  '21:9',
  '9:21'
]

function getCustomOpenAIImageAspectRatios(model: string): string[] {
  const normalizedModel = normalizeModelId(model).toLowerCase()
  if (normalizedModel === 'gpt-image-2' || normalizedModel === 'gpt-image-2-official') {
    return APIMART_GPT_IMAGE_2_ASPECT_RATIOS
  }

  return ['1:1', '16:9', '9:16', '4:3', '3:4']
}

function getCustomOpenAIImageQualities(model: string): string[] | undefined {
  const normalizedModel = normalizeModelId(model).toLowerCase()

  if (normalizedModel === 'gpt-image-2') {
    return ['1k', '2k', '4k']
  }

  if (supportsOpenAIImageQuality(model)) {
    return ['auto', 'low', 'medium', 'high']
  }

  return undefined
}

function buildCustomOpenAIImageModels(): ImageModelConfig[] {
  if (!customOpenAIConfig.enabled) return []

  return customOpenAIConfig.textModels
    .filter(isCustomOpenAIImageModel)
    .map(model => ({
      provider: 'custom_openai',
      model,
      displayName: model,
      description: `${customOpenAIConfig.displayName} - OpenAI 兼容图片模型`,
      supportedAspectRatios: getCustomOpenAIImageAspectRatios(model),
      supportedQualities: getCustomOpenAIImageQualities(model),
      supportReferenceImage: supportsOpenAIImageEdit(model)
    }))
}

export function getCustomOpenAIProviderConfig(): CustomOpenAIProviderConfig {
  return {
    ...customOpenAIConfig,
    textModels: [...customOpenAIConfig.textModels],
    availableTextModels: [...customOpenAIConfig.availableTextModels]
  }
}

export function getCustomOpenAIProviderPublicConfig(): CustomOpenAIProviderPublicConfig {
  return {
    enabled: customOpenAIConfig.enabled,
    displayName: customOpenAIConfig.displayName,
    baseUrl: customOpenAIConfig.baseUrl,
    textModels: [...customOpenAIConfig.textModels],
    availableTextModels: [...customOpenAIConfig.availableTextModels],
    hasApiKey: !!customOpenAIConfig.apiKey,
    modelsSyncedAt: customOpenAIConfig.modelsSyncedAt,
    modelsSyncError: customOpenAIConfig.modelsSyncError
  }
}

export async function initializeCustomOpenAIProvider(): Promise<void> {
  customOpenAIConfig = await readCustomOpenAIConfigFromDB()
  providerSyncedCatalog = await readProviderModelCatalogFromDB()
}

export async function setCustomOpenAIProviderConfig(
  patch: Partial<CustomOpenAIProviderConfig> & { apiKey?: string | undefined }
): Promise<CustomOpenAIProviderPublicConfig> {
  const current = await readCustomOpenAIConfigFromDB()
  const nextApiKey = Object.prototype.hasOwnProperty.call(patch, 'apiKey')
    ? patch.apiKey
    : current.apiKey

  await saveCustomOpenAIConfigToDB({
    ...current,
    ...patch,
    apiKey: nextApiKey || ''
  })

  return getCustomOpenAIProviderPublicConfig()
}

export async function syncCustomOpenAIProviderModels(
  patch: Partial<CustomOpenAIProviderConfig> & { apiKey?: string | undefined } = {}
): Promise<CustomOpenAIProviderPublicConfig> {
  const current = await readCustomOpenAIConfigFromDB()
  const nextApiKey = Object.prototype.hasOwnProperty.call(patch, 'apiKey')
    ? patch.apiKey
    : current.apiKey
  const baseConfig = normalizeCustomOpenAIConfig({
    ...current,
    ...patch,
    apiKey: nextApiKey || current.apiKey || ''
  })

  try {
    const availableTextModels = await listOpenAICompatibleModels(baseConfig)
    const previousEnabled = new Set(baseConfig.textModels)
    const hasPreviousSelection = baseConfig.textModels.length > 0
      || !!baseConfig.modelsSyncedAt
      || baseConfig.availableTextModels.length > 0
    const textModels = hasPreviousSelection
      ? availableTextModels.filter(model => previousEnabled.has(model))
      : availableTextModels
    const synced = normalizeCustomOpenAIConfig({
      ...baseConfig,
      enabled: true,
      textModels,
      availableTextModels,
      modelsSyncedAt: new Date().toISOString(),
      modelsSyncError: undefined
    })
    await saveCustomOpenAIConfigToDB(synced)
    return getCustomOpenAIProviderPublicConfig()
  } catch (error) {
    const failed = normalizeCustomOpenAIConfig({
      ...baseConfig,
      modelsSyncError: error instanceof Error ? error.message : String(error)
    })
    await saveCustomOpenAIConfigToDB(failed)
    throw error
  }
}

function getRuntimeProviderConfig(provider: SyncableProvider): { apiKey?: string, baseUrl?: string, configured: boolean } {
  const runtimeConfig = useRuntimeConfig()

  if (provider === 'qwen') {
    const apiKey = String(runtimeConfig.qwenApiKey || '').trim()
    return { apiKey, baseUrl: QWEN_COMPATIBLE_URL, configured: !!apiKey }
  }

  if (provider === 'volcengine') {
    const apiKey = String(runtimeConfig.volcengineApiKey || '').trim()
    return { apiKey, baseUrl: VOLCENGINE_BASE_URL, configured: !!apiKey }
  }

  if (provider === 'deepseek') {
    const apiKey = String(runtimeConfig.deepseekApiKey || '').trim()
    return { apiKey, baseUrl: DEEPSEEK_BASE_URL, configured: !!apiKey }
  }

  if (provider === 'gemini') {
    const apiKey = String(runtimeConfig.geminiApiKey || '').trim()
    return { apiKey, configured: !!apiKey }
  }

  if (provider === 'kling') {
    const accessKey = String(runtimeConfig.klingAccessKey || '').trim()
    const secretKey = String(runtimeConfig.klingSecretKey || '').trim()
    return { configured: !!accessKey && !!secretKey }
  }

  return {
    apiKey: customOpenAIConfig.apiKey,
    baseUrl: customOpenAIConfig.baseUrl,
    configured: !!customOpenAIConfig.apiKey && !!customOpenAIConfig.baseUrl
  }
}

export function getDeepSeekOpenAICompatibleConfig(): { apiKey: string, baseUrl: string } {
  const cfg = getRuntimeProviderConfig('deepseek')
  if (!cfg.configured || !cfg.apiKey || !cfg.baseUrl) {
    throw new Error('DEEPSEEK_API_KEY 环境变量未设置')
  }
  return {
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl
  }
}

function getStaticProviderModels(provider: SyncableProvider): string[] {
  return Array.from(new Set(
    [...TEXT_MODELS, ...IMAGE_MODELS, ...VIDEO_MODELS, ...VOICE_MODELS]
      .filter(model => model.provider === provider)
      .map(model => model.model)
  )).sort((a, b) => a.localeCompare(b))
}

async function syncOpenAICompatibleProviderCatalog(
  provider: Extract<SyncableProvider, 'qwen' | 'volcengine' | 'deepseek'>
): Promise<ProviderSyncedCatalogEntry> {
  const cfg = getRuntimeProviderConfig(provider)
  if (!cfg.configured || !cfg.apiKey || !cfg.baseUrl) {
    throw new Error(`${provider} API Key 未配置`)
  }

  const availableModels = await listOpenAICompatibleModels({
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl
  })
  const hasPreviousSelection = Array.isArray(providerSyncedCatalog[provider]?.models)
  const previousEnabled = new Set(providerSyncedCatalog[provider]?.models || [])
  const models = hasPreviousSelection
    ? availableModels.filter(model => previousEnabled.has(model))
    : availableModels

  return {
    models,
    availableModels,
    syncedAt: new Date().toISOString(),
    syncError: undefined
  }
}

export async function syncModelProviderCatalog(provider: SyncableProvider): Promise<ModelProviderSummary> {
  await initializeCustomOpenAIProvider()
  const catalog = await readProviderModelCatalogFromDB()

  try {
    if (provider === 'custom_openai') {
      await syncCustomOpenAIProviderModels()
      providerSyncedCatalog = await readProviderModelCatalogFromDB()
      return getModelProviderSummaries().find(item => item.provider === provider)!
    }

    if (provider !== 'qwen' && provider !== 'volcengine' && provider !== 'deepseek') {
      throw new Error(`${provider} 暂无官方模型列表同步接口，继续使用本地能力表`)
    }

    catalog[provider] = await syncOpenAICompatibleProviderCatalog(provider)
    await saveProviderModelCatalogToDB(catalog)
    return getModelProviderSummaries().find(item => item.provider === provider)!
  } catch (error) {
    catalog[provider] = {
      models: catalog[provider]?.models || [],
      availableModels: catalog[provider]?.availableModels || [],
      syncedAt: catalog[provider]?.syncedAt,
      syncError: error instanceof Error ? error.message : String(error)
    }
    await saveProviderModelCatalogToDB(catalog)
    throw error
  }
}

export async function setModelProviderEnabledModels(
  provider: SyncableProvider,
  models: string[]
): Promise<ModelProviderSummary> {
  await initializeCustomOpenAIProvider()
  const enabledModels = Array.from(new Set(models.map(model => normalizeModelId(model)).filter(Boolean)))

  if (provider === 'custom_openai') {
    const current = await readCustomOpenAIConfigFromDB()
    await saveCustomOpenAIConfigToDB({
      ...current,
      textModels: enabledModels,
      enabled: current.enabled || enabledModels.length > 0
    })
    return getModelProviderSummaries().find(item => item.provider === provider)!
  }

  const catalog = await readProviderModelCatalogFromDB()
  const availableModels = catalog[provider]?.availableModels?.length
    ? catalog[provider]!.availableModels!
    : getStaticProviderModels(provider)

  catalog[provider] = {
    ...catalog[provider],
    availableModels,
    models: enabledModels.filter(model => availableModels.includes(model))
  }
  await saveProviderModelCatalogToDB(catalog)
  return getModelProviderSummaries().find(item => item.provider === provider)!
}

export function getModelProviderSummaries(): ModelProviderSummary[] {
  const providers: Array<Omit<ModelProviderSummary, 'configured' | 'syncedAt' | 'syncError' | 'modelCount' | 'models' | 'availableModels'>> = [
    {
      provider: 'qwen',
      displayName: '通义千问',
      description: '通过 DashScope OpenAI 兼容 /models 同步账号可用模型，再按本地能力表过滤可用流程模型。',
      syncMode: 'official_api',
      supportedDynamicSync: true
    },
    {
      provider: 'volcengine',
      displayName: '火山引擎',
      description: '通过方舟 OpenAI 兼容 /models 同步账号可用模型，再按本地能力表过滤可用流程模型。',
      syncMode: 'official_api',
      supportedDynamicSync: true
    },
    {
      provider: 'deepseek',
      displayName: 'DeepSeek',
      description: '通过 DeepSeek 官方 OpenAI 兼容 /models 同步账号可用模型，默认接入文本生成流程。',
      syncMode: 'official_api',
      supportedDynamicSync: true
    },
    {
      provider: 'custom_openai',
      displayName: customOpenAIConfig.displayName || '自定义 OpenAI',
      description: '通过自定义 OpenAI 兼容 /models 同步模型，默认接入文本生成流程。',
      syncMode: 'official_api',
      supportedDynamicSync: true
    },
    {
      provider: 'gemini',
      displayName: 'Google Gemini',
      description: '当前使用本地能力表；模型能力仍由 Gemini 专用接口和仓库能力配置约束。',
      syncMode: 'manual',
      supportedDynamicSync: false
    },
    {
      provider: 'kling',
      displayName: '可灵 AI',
      description: '当前使用本地能力表；图片/视频能力依赖可灵专用接口参数。',
      syncMode: 'manual',
      supportedDynamicSync: false
    }
  ]

  return providers.map((provider) => {
    const synced = providerSyncedCatalog[provider.provider]
    const availableModels = provider.provider === 'custom_openai'
      ? customOpenAIConfig.availableTextModels.length > 0
        ? customOpenAIConfig.availableTextModels
        : customOpenAIConfig.textModels
      : synced?.availableModels?.length
        ? synced.availableModels
        : getStaticProviderModels(provider.provider)
    const models = provider.provider === 'custom_openai'
      ? customOpenAIConfig.textModels
      : Array.isArray(synced?.models)
        ? synced.models
        : availableModels
    const runtime = getRuntimeProviderConfig(provider.provider)

    return {
      ...provider,
      configured: runtime.configured,
      syncedAt: provider.provider === 'custom_openai' ? customOpenAIConfig.modelsSyncedAt : synced?.syncedAt,
      syncError: provider.provider === 'custom_openai' ? customOpenAIConfig.modelsSyncError : synced?.syncError,
      modelCount: models.length,
      models,
      availableModels
    }
  })
}

export function getTextModels(): TextModelConfig[] {
  return dedupeModelsByModelId(filterModelsBySyncedCatalog([...TEXT_MODELS, ...buildCustomOpenAITextModels()]))
}

export function getImageModels(): ImageModelConfig[] {
  return dedupeModelsByModelId(filterModelsBySyncedCatalog([...IMAGE_MODELS, ...buildCustomOpenAIImageModels()]))
}

export function getVideoModels(): VideoModelConfig[] {
  return filterModelsBySyncedCatalog(VIDEO_MODELS)
}

export function getVoiceModels(): VoiceModelConfig[] {
  return filterModelsBySyncedCatalog(VOICE_MODELS)
}

const GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9'
] as const

const GEMINI_3_PRO_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9'
] as const

const QWEN_IMAGE_PRIMARY_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'] as const
const QWEN_IMAGE_2_CUSTOM_ASPECT_RATIOS = ['2:1', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const
const QWEN_WAN_IMAGE_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'] as const

const KLING_OMNI_IMAGE_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', 'auto'] as const

const VOLCENGINE_IMAGE_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'] as const

/** 所有可用的图片模型 */
export const IMAGE_MODELS: ImageModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.ImageModels.HIGH_QUALITY,
    displayName: 'Gemini 3 Pro Image',
    description: '4K高质量图片生成',
    supportedAspectRatios: [...GEMINI_3_PRO_IMAGE_ASPECT_RATIOS],
    supportReferenceImage: true,
    docUrl: 'https://ai.google.dev/gemini-api/docs/image-generation'
  },
  {
    provider: 'gemini',
    model: gemini.ImageModels.FAST,
    displayName: 'Gemini 3.1 Flash Image',
    description: '快速生成',
    supportedAspectRatios: [...GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS],
    supportReferenceImage: true,
    docUrl: 'https://ai.google.dev/gemini-api/docs/image-generation'
  },
  // 千问模型
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.QWEN_IMAGE_2_PRO,
    displayName: '通义千问 Image 2.0 Pro',
    description: '千问最新图像生成与编辑 Pro 系列，文字渲染与语义遵循更强',
    supportedAspectRatios: [...QWEN_IMAGE_2_CUSTOM_ASPECT_RATIOS],
    supportReferenceImage: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-image-api'
  },
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.WAN_2_7_IMAGE_PRO,
    displayName: '通义万相 2.7 Image Pro',
    description: '万相 2.7 高质量生成与编辑模型，支持多图编辑和组图',
    supportedAspectRatios: [...QWEN_WAN_IMAGE_ASPECT_RATIOS],
    supportReferenceImage: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.WAN_2_7_IMAGE,
    displayName: '通义万相 2.7 Image',
    description: '万相 2.7 标准版，兼顾效果与成本',
    supportedAspectRatios: [...QWEN_WAN_IMAGE_ASPECT_RATIOS],
    supportReferenceImage: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.Z_IMAGE_TURBO,
    displayName: '通义 Z-Image',
    description: 'Z-Image 轻量快速生图模型（z-image-turbo）',
    supportedAspectRatios: [...QWEN_IMAGE_PRIMARY_ASPECT_RATIOS],
    supportReferenceImage: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/z-image-api-reference'
  },
  // 可灵 AI 图片模型
  {
    provider: 'kling',
    model: kling.KlingImageModels.KLING_IMAGE_O1,
    displayName: '可灵 Kling Image O1',
    description: 'Omni 图像模型，支持多图参考、主体融合与组图',
    supportedAspectRatios: [...KLING_OMNI_IMAGE_ASPECT_RATIOS],
    supportReferenceImage: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/OmniImage'
  },
  {
    provider: 'kling',
    model: kling.KlingImageModels.KLING_V3_OMNI,
    displayName: '可灵 Kling v3 Omni（图像）',
    description: 'Omni 图像模型，支持 1K/2K/4K 与主体/图片混合参考',
    supportedAspectRatios: [...KLING_OMNI_IMAGE_ASPECT_RATIOS],
    supportReferenceImage: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/OmniImage'
  },
  // 火山引擎 (豆包 Seedream) 图片模型
  {
    provider: 'volcengine',
    model: volcengine.VolcengineImageModels.SEEDREAM_5_0,
    displayName: '豆包 Seedream 5.0',
    description: '最新旗舰图片模型，支持文生图/图生图/多参考图',
    supportedAspectRatios: [...VOLCENGINE_IMAGE_ASPECT_RATIOS],
    supportReferenceImage: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  },
  {
    provider: 'volcengine',
    model: volcengine.VolcengineImageModels.SEEDREAM_5_0_LITE,
    displayName: '豆包 Seedream 5.0 Lite',
    description: '高速高性价比图片生成',
    supportedAspectRatios: [...VOLCENGINE_IMAGE_ASPECT_RATIOS],
    supportReferenceImage: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  }
]

/** 所有可用的视频模型 */
export const VIDEO_MODELS: VideoModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.VideoModels.VEO_3_1,
    displayName: 'Veo 3.1',
    description: '支持首尾帧插值',
    maxDuration: 8,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 3,
    supportTextToVideo: true,
    docUrl: 'https://ai.google.dev/gemini-api/docs/video'
  },
  {
    provider: 'gemini',
    model: gemini.VideoModels.VEO_3_1_FAST,
    displayName: 'Veo 3.1 Fast',
    description: '速度优化版本（Fast）',
    maxDuration: 8,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 3,
    supportTextToVideo: true,
    docUrl: 'https://ai.google.dev/gemini-api/docs/video'
  },
  // 千问模型 (通义万相 2.7)
  {
    provider: 'qwen',
    model: qwen.QwenVideoModels.WAN_2_7_T2V,
    displayName: '通义万相 2.7 文生视频',
    description: 'wan2.7-t2v，支持多镜头叙事与音频驱动',
    maxDuration: 15,
    supportFirstLastFrame: false,
    supportImageToVideo: false,
    supportTextToVideo: true,
    supportAudioReference: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/text-to-video-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenVideoModels.WAN_2_7_I2V,
    displayName: '通义万相 2.7 图生视频',
    description: 'wan2.7-i2v，支持首帧/首尾帧/续写与驱动音频',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: false,
    supportAudioReference: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenVideoModels.WAN_2_7_R2V,
    displayName: '通义万相 2.7 参考生视频',
    description: 'wan2.7-r2v，支持多参考图/视频与参考音色',
    maxDuration: 15,
    supportFirstLastFrame: false,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 5,
    supportTextToVideo: false,
    supportAudioReference: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/wan-video-to-video-api-reference'
  },
  // 可灵 AI 视频模型
  {
    provider: 'kling',
    model: kling.KlingVideoModels.KLING_VIDEO_O1,
    displayName: '可灵 Kling Video O1',
    description: 'Omni 视频模型，支持文本/图片/视频混合参考与多镜头',
    maxDuration: 10,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 7,
    supportTextToVideo: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/OmniVideo'
  },
  {
    provider: 'kling',
    model: kling.KlingVideoModels.KLING_V3_OMNI,
    displayName: '可灵 Kling v3 Omni（视频）',
    description: 'Omni 3.0 视频模型，支持多镜头与复杂主体控制',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 7,
    supportTextToVideo: true,
    supportAudioReference: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/OmniVideo'
  },
  // 火山引擎 (豆包 Seedance) 视频模型 - 仅保留支持首尾帧的模型
  {
    provider: 'volcengine',
    model: volcengine.VolcengineVideoModels.SEEDANCE_2_0,
    displayName: '豆包 Seedance 2.0',
    description: '最新视频模型，支持首尾帧/首帧/文生视频（4-15秒）',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 9,
    supportTextToVideo: true,
    supportAudioReference: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  },
  {
    provider: 'volcengine',
    model: volcengine.VolcengineVideoModels.SEEDANCE_2_0_FAST,
    displayName: '豆包 Seedance 2.0 Fast',
    description: '高速视频模型，支持首尾帧与图生视频（4-15秒）',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 9,
    supportTextToVideo: true,
    supportAudioReference: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  }
]

/** 所有可用的语音模型 */
export const VOICE_MODELS: VoiceModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.AudioModels.LYRIA,
    displayName: 'Lyria',
    description: '背景音乐生成',
    type: 'tts',
    docUrl: 'https://ai.google.dev/gemini-api/docs/audio'
  },
  // 千问模型
  {
    provider: 'qwen',
    model: qwen.QwenVoiceModels.QWEN3_TTS_FLASH,
    displayName: '通义千问3-TTS-Instruct-Flash',
    description: '高表现力多语言拟人音色',
    type: 'tts',
    supportedLanguages: ['zh', 'en', 'ja', 'ko'],
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-tts-api'
  },
  {
    provider: 'qwen',
    model: qwen.QwenVoiceModels.QWEN3_ASR_FLASH,
    displayName: '通义千问3-ASR-Flash',
    description: '精准多语言转写与情绪识别',
    type: 'asr',
    supportedLanguages: ['zh', 'en', 'ja', 'ko'],
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenVoiceModels.FUN_ASR_MTL,
    displayName: '百聆-FUN-ASR-Mtl',
    description: '高准确率方言及多语言语音识别',
    type: 'asr',
    supportedLanguages: ['zh', 'en', 'ja', 'ko', 'yue', 'wuu'],
    docUrl: 'https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-api-reference'
  }
]

// ============================================================
// 当前选择的模型（内存 + 数据库存储）
// ============================================================

const SELECTED_MODELS_KEY = 'selected_models'

const DEFAULT_SELECTED_MODELS: SelectedModels = {
  text: qwen.QwenTextModels.QWEN_PLUS_THINKING, // 默认使用千问
  image: qwen.QwenImageModels.QWEN_IMAGE_2_PRO, // 默认使用千问
  video: qwen.QwenVideoModels.WAN_2_7_T2V, // 默认使用千问
  tts: qwen.QwenVoiceModels.QWEN3_TTS_FLASH,
  asr: qwen.QwenVoiceModels.QWEN3_ASR_FLASH
}

const currentModels: SelectedModels = { ...DEFAULT_SELECTED_MODELS }
let selectedModelsInitialized = false

const MODEL_ID_ALIASES: Record<string, string> = {
  'z-image': qwen.QwenImageModels.Z_IMAGE_TURBO
}

export function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim()
  if (!trimmed) return modelId
  return MODEL_ID_ALIASES[trimmed.toLowerCase()] || trimmed
}

function isValidModelForType(type: keyof SelectedModels, modelId: string): boolean {
  const normalizedModelId = normalizeModelId(modelId)

  switch (type) {
    case 'text':
      return !!findTextModel(normalizedModelId)
    case 'image':
      return !!findImageModel(normalizedModelId)
    case 'video':
      return !!findVideoModel(normalizedModelId)
    case 'tts': {
      const voice = findVoiceModel(normalizedModelId)
      return !!voice && voice.type === 'tts'
    }
    case 'asr': {
      const voice = findVoiceModel(normalizedModelId)
      return !!voice && voice.type === 'asr'
    }
    default:
      return false
  }
}

function normalizeSelectedModels(raw: unknown): SelectedModels {
  const normalized: SelectedModels = { ...DEFAULT_SELECTED_MODELS }

  if (!raw || typeof raw !== 'object') {
    return normalized
  }

  const source = raw as Partial<Record<keyof SelectedModels, unknown>>
  const keys: Array<keyof SelectedModels> = ['text', 'image', 'video', 'tts', 'asr']

  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') {
      const normalizedValue = normalizeModelId(value)
      if (isValidModelForType(key, normalizedValue)) {
        normalized[key] = normalizedValue
      }
    }
  }

  return normalized
}

async function saveSelectedModelsToDB(models: SelectedModels): Promise<void> {
  const now = new Date().toISOString()
  await db.insert(systemConfig)
    .values({
      key: SELECTED_MODELS_KEY,
      value: JSON.stringify(models),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: JSON.stringify(models),
        updatedAt: now
      }
    })
}

/**
 * 初始化全局模型选择（从数据库恢复）
 */
export async function initializeSelectedModels(): Promise<void> {
  try {
    // 供应商模型勾选与自定义 OpenAI 配置可能被其他请求/实例更新，
    // 每次初始化入口都先从数据库刷新，避免流程模型页与供应商页状态不一致。
    await initializeCustomOpenAIProvider()
  } catch (error) {
    console.error('[Models] 刷新供应商模型目录失败，继续使用内存缓存:', error)
  }

  if (selectedModelsInitialized) {
    return
  }

  try {
    const rows = await db.select()
      .from(systemConfig)
      .where(eq(systemConfig.key, SELECTED_MODELS_KEY))
      .limit(1)

    const row = rows[0]
    if (row?.value) {
      const parsed = JSON.parse(row.value)
      const normalized = normalizeSelectedModels(parsed)
      Object.assign(currentModels, normalized)
      console.log('[Models] 已从数据库加载全局模型配置')
    } else {
      await saveSelectedModelsToDB(currentModels)
      console.log('[Models] 已写入默认全局模型配置')
    }
  } catch (error) {
    console.error('[Models] 初始化全局模型配置失败，使用默认值:', error)
  } finally {
    selectedModelsInitialized = true
  }
}

export function getSelectedModels(): SelectedModels {
  return { ...currentModels }
}

export async function setSelectedModel(type: keyof SelectedModels, modelId: string): Promise<void> {
  currentModels[type] = normalizeModelId(modelId)
  await saveSelectedModelsToDB(currentModels)
}

// ============================================================
// 模型查找辅助函数
// ============================================================

export function findTextModel(modelId: string): TextModelConfig | undefined {
  const normalizedModelId = normalizeModelId(modelId)
  return getTextModels().find(m => m.model === normalizedModelId)
}

export function findImageModel(modelId: string): ImageModelConfig | undefined {
  const normalizedModelId = normalizeModelId(modelId)
  return getImageModels().find(m => m.model === normalizedModelId)
}

export function findVideoModel(modelId: string): VideoModelConfig | undefined {
  const normalizedModelId = normalizeModelId(modelId)
  return getVideoModels().find(m => m.model === normalizedModelId)
}

export function findVoiceModel(modelId: string): VoiceModelConfig | undefined {
  const normalizedModelId = normalizeModelId(modelId)
  return getVoiceModels().find(m => m.model === normalizedModelId)
}

function getProviderFromModel(modelId: string): ModelProvider {
  const normalizedModelId = normalizeModelId(modelId)
  const allModels = [...getTextModels(), ...getImageModels(), ...getVideoModels(), ...getVoiceModels()]
  const model = allModels.find(m => m.model === normalizedModelId)
  return model?.provider || 'gemini'
}

// ============================================================
// 统一 API 封装 - 文本生成
// ============================================================

export async function generateText(options: {
  modelId?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
  enableThinking?: boolean
}): Promise<string> {
  const modelId = normalizeModelId(options.modelId || currentModels.text)
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] generateText - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenGenerateText({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries,
      enableThinking: options.enableThinking
    })
  }

  if (provider === 'volcengine') {
    return volcengine._volcengineGenerateText({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries,
      enableThinking: options.enableThinking
    })
  }

  if (provider === 'deepseek') {
    return generateOpenAICompatibleText({
      providerConfig: getDeepSeekOpenAICompatibleConfig(),
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries,
      debugProvider: 'deepseek'
    })
  }

  if (provider === 'custom_openai') {
    return generateOpenAICompatibleText({
      providerConfig: getCustomOpenAIProviderConfig(),
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  // 默认使用 Gemini
  return gemini._geminiGenerateText({
    model: modelId,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })
}

export async function generateJSON<T>(options: {
  modelId?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<T> {
  const modelId = normalizeModelId(options.modelId || currentModels.text)
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] generateJSON - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenGenerateJSON<T>({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  if (provider === 'volcengine') {
    return volcengine._volcengineGenerateJSON<T>({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  if (provider === 'deepseek') {
    return generateOpenAICompatibleJSON<T>({
      providerConfig: getDeepSeekOpenAICompatibleConfig(),
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries,
      debugProvider: 'deepseek'
    })
  }

  if (provider === 'custom_openai') {
    return generateOpenAICompatibleJSON<T>({
      providerConfig: getCustomOpenAIProviderConfig(),
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  return gemini._geminiGenerateJSON<T>({
    model: modelId,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })
}

// ============================================================
// 统一 API 封装 - 图片生成
// ============================================================

export interface GenerateImageResult {
  imageData?: string // base64 (Gemini)
  imageUrl?: string // URL (Qwen/Kling/Volcengine)
  mimeType?: string
  text?: string
}

export async function generateImage(options: {
  modelId?: string
  prompt: string
  referenceImage?: { data: string, mimeType: string }
  referenceImages?: string[] // base64 图片数组 (用于 wan2.7/wan2.6-image 等支持多参考图的模型)
  allowTextOnlyResult?: boolean
  negativePrompt?: string
  size?: string
  imageSize?: gemini.GeminiImageSize | string
  aspectRatio?: string
  quality?: string
  maxRetries?: number
}): Promise<GenerateImageResult> {
  const modelId = normalizeModelId(options.modelId || currentModels.image)
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] generateImage - provider: ${provider}, model: ${modelId}, refImages: ${options.referenceImages?.length || 0}`)

  if (provider === 'qwen') {
    const result = await qwen._qwenGenerateImage({
      model: modelId,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      size: options.size,
      referenceImages: options.referenceImages,
      maxRetries: options.maxRetries
    })
    return { imageUrl: result.imageUrl }
  }

  if (provider === 'volcengine') {
    const result = await volcengine._volcengineGenerateImage({
      model: modelId,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      size: options.size,
      referenceImages: options.referenceImages,
      maxRetries: options.maxRetries
    })
    return { imageUrl: result.imageUrl }
  }

  if (provider === 'kling') {
    const klingReferenceImages = options.referenceImages && options.referenceImages.length > 0
      ? options.referenceImages
      : options.referenceImage?.data
        ? [options.referenceImage.data]
        : undefined

    const result = await kling._klingGenerateImage({
      model: modelId,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      size: options.size,
      aspectRatio: options.aspectRatio,
      referenceImages: klingReferenceImages,
      maxRetries: options.maxRetries
    })
    return { imageUrl: result.imageUrl }
  }

  if (provider === 'custom_openai') {
    const openAIReferenceImages = options.referenceImages && options.referenceImages.length > 0
      ? options.referenceImages
      : options.referenceImage?.data
        ? [`data:${options.referenceImage.mimeType};base64,${options.referenceImage.data}`]
        : undefined

    return generateOpenAICompatibleImage({
      providerConfig: getCustomOpenAIProviderConfig(),
      model: modelId,
      prompt: options.prompt,
      size: options.size,
      aspectRatio: options.aspectRatio,
      quality: options.quality,
      referenceImages: openAIReferenceImages,
      maxRetries: options.maxRetries
    })
  }

  // Gemini
  const result = await gemini._geminiGenerateImage({
    model: modelId,
    prompt: options.prompt,
    referenceImage: options.referenceImage,
    referenceImages: options.referenceImages,
    imageSize: options.imageSize,
    aspectRatio: options.aspectRatio,
    size: options.size,
    allowTextOnlyResult: options.allowTextOnlyResult,
    maxRetries: options.maxRetries
  })
  return {
    imageData: result.imageData,
    mimeType: result.mimeType,
    text: result.text
  }
}

// ============================================================
// 统一 API 封装 - 视频生成
// ============================================================

export interface GenerateVideoResult {
  videoData?: string // base64 或 ref (Gemini)
  videoUrl?: string // URL (Qwen/Kling/Volcengine)
  taskId: string
}

export async function generateVideo(options: {
  modelId?: string
  prompt: string
  firstFrame?: string // base64 (Gemini)
  lastFrame?: string // base64 (Gemini)
  firstFrameUrl?: string // 首帧图片 URL (Qwen 首尾帧模型)
  lastFrameUrl?: string // 尾帧图片 URL (Qwen 首尾帧模型)
  imageUrl?: string // 图生视频输入 (Qwen)
  referenceImages?: string[] // 多参考图/视频输入 (Qwen wan2.7-r2v 等)
  audioUrl?: string // 显式音频参考
  duration?: number
  aspectRatio?: string
  size?: string // Qwen 使用 size 如 '1280*720'
  resolution?: string // 分辨率档位: 480P, 720P, 1080P (Qwen wan2.7/首尾帧模型)
  negativePrompt?: string
  promptExtend?: boolean
  audio?: boolean
  watermark?: boolean
  seed?: number
  maxRetries?: number
}): Promise<GenerateVideoResult> {
  const modelId = normalizeModelId(options.modelId || currentModels.video)
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] generateVideo - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    const result = await qwen._qwenGenerateVideo({
      model: modelId,
      prompt: options.prompt,
      imageUrl: options.imageUrl,
      firstFrameUrl: options.firstFrameUrl,
      lastFrameUrl: options.lastFrameUrl,
      referenceImages: options.referenceImages,
      audioUrl: options.audioUrl,
      duration: options.duration,
      aspectRatio: options.aspectRatio,
      size: options.size,
      resolution: options.resolution,
      negativePrompt: options.negativePrompt,
      promptExtend: options.promptExtend,
      audio: options.audio,
      watermark: options.watermark,
      seed: options.seed,
      maxRetries: options.maxRetries
    })
    return {
      videoUrl: result.videoUrl,
      taskId: result.taskId
    }
  }

  if (provider === 'volcengine') {
    const result = await volcengine._volcengineGenerateVideo({
      model: modelId,
      prompt: options.prompt,
      imageUrl: options.imageUrl,
      firstFrameUrl: options.firstFrameUrl,
      lastFrameUrl: options.lastFrameUrl,
      audioUrl: options.audioUrl,
      withAudio: options.audio,
      duration: options.duration,
      size: options.size,
      resolution: options.resolution,
      negativePrompt: options.negativePrompt,
      maxRetries: options.maxRetries
    })
    return {
      videoUrl: result.videoUrl,
      taskId: result.taskId
    }
  }

  if (provider === 'kling') {
    const result = await kling._klingGenerateVideo({
      model: modelId,
      prompt: options.prompt,
      imageUrl: options.imageUrl,
      firstFrameUrl: options.firstFrameUrl,
      lastFrameUrl: options.lastFrameUrl,
      audioUrl: options.audioUrl,
      duration: options.duration,
      aspectRatio: options.aspectRatio,
      withAudio: options.audio,
      mode: 'pro',
      negativePrompt: options.negativePrompt,
      maxRetries: options.maxRetries
    })
    return {
      videoUrl: result.videoUrl,
      taskId: result.taskId
    }
  }

  // Gemini - 需要通过原有的 video API 处理
  // 这里返回一个占位，实际视频生成仍通过 /api/video/generate
  throw new Error('Gemini 视频生成请使用 /api/video/generate API')
}

// ============================================================
// 统一 API 封装 - 语音合成
// ============================================================

export async function textToSpeech(options: {
  modelId?: string
  text: string
  voice?: string
  speed?: number
  maxRetries?: number
}): Promise<{ audioData: string, audioUrl?: string }> {
  const modelId = normalizeModelId(options.modelId || currentModels.tts || qwen.QwenVoiceModels.QWEN3_TTS_FLASH)
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] textToSpeech - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenTextToSpeech({
      model: modelId,
      text: options.text,
      voice: options.voice,
      speed: options.speed,
      maxRetries: options.maxRetries
    })
  }

  // Gemini 暂不支持 TTS，使用千问
  return qwen._qwenTextToSpeech({
    model: qwen.QwenVoiceModels.QWEN3_TTS_FLASH,
    text: options.text,
    voice: options.voice,
    speed: options.speed,
    maxRetries: options.maxRetries
  })
}

// ============================================================
// 统一 API 封装 - 语音识别
// ============================================================

export async function speechToText(options: {
  modelId?: string
  audioUrl?: string
  audioData?: string
  language?: string
  maxRetries?: number
}): Promise<{ text: string }> {
  const modelId = normalizeModelId(options.modelId || currentModels.asr || qwen.QwenVoiceModels.QWEN3_ASR_FLASH)
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] speechToText - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenSpeechToText({
      model: modelId,
      audioUrl: options.audioUrl,
      audioData: options.audioData,
      language: options.language,
      maxRetries: options.maxRetries
    })
  }

  // Gemini 暂不支持 ASR，使用千问
  return qwen._qwenSpeechToText({
    model: qwen.QwenVoiceModels.QWEN3_ASR_FLASH,
    audioUrl: options.audioUrl,
    audioData: options.audioData,
    language: options.language,
    maxRetries: options.maxRetries
  })
}
