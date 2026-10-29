import openaiModelCatalog from '../assets/openai-model-catalog.json'

export interface ProviderModelCatalogEntry {
  model: string
  kind: string
  category: string
  displayName: string
  description: string
  docUrl: null
  capabilities: string[]
}

export interface NativeProviderModel {
  model: string
  name?: string
  description?: string
  capabilities?: string[]
  inference_metadata?: { response_modality?: string[] }
}

export interface ProviderModelStateInput {
  nativeModelsJson?: string | null
  providerKey: string
  modelsJson?: string | null
  availableModelsJson?: string | null
  syncedAt?: string | null
  syncError?: string | null
}

export interface ProviderModelState {
  nativeModels: NativeProviderModel[]
  models: string[]
  availableModels: string[]
  availableModelCatalog: ProviderModelCatalogEntry[]
  syncedAt: string | null
  syncError: string | null
}

export type ModelCategory = 'text' | 'image' | 'video' | 'voice' | 'three_d' | 'other'

export const CLIENT_MODEL_PROVIDER_KEYS = [
  'autodl',
  'topaz',
  'gemini',
  'qwen',
  'volcengine',
  'deepseek',
  'openai',
  'kling',
  'custom_openai'
] as const

const SYNCABLE_PROVIDER_KEYS = new Set(['qwen', 'volcengine', 'deepseek', 'custom_openai', 'openai'])

export function normalizeProviderKey(value: string) {
  return value.trim().toLowerCase()
}

export function normalizeModelList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : []
  const output: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const normalized = item.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }
  return output
}

export function parseModelListText(value: string | null | undefined) {
  if (!value) return []
  try {
    return normalizeModelList(JSON.parse(value))
  } catch {
    return []
  }
}

export function manualProviderSeedAvailableModels(providerKey: string): string[] {
  switch (normalizeProviderKey(providerKey)) {
    case 'autodl':
      return ['minimax_h3_zm_u24', 'minimax_h3_zm_u08', 'minimax_h3_lightx2v_no_pic', 'minimax_h3_lightx2v']
    case 'topaz':
      return ['ganim-1', 'prob-4']
    case 'qwen':
      return [
        'qwen3.8-max',
        'qwen3.7-plus',
        'qwen3.8-flash',
        'qwen-image-3.0-pro',
        'qwen-image-3.0',
        'qwen-image-2.1-pro',
        'qwen-image-2.1-turbo',
        'wan3.0-video',
        'wan3.0-video-prime',
        'happyhorse-1.1-t2v',
        'happyhorse-1.1-i2v',
        'happyhorse-1.1-r2v',
        'qwen3.6-plus',
        'qwen3-max-2026-01-23',
        'qwen-image-2.0-pro',
        'wan2.7-image-pro',
        'wan2.7-image',
        'z-image-turbo',
        'wan2.7-t2v',
        'wan2.7-i2v',
        'wan2.7-r2v',
        'qwen3-tts-instruct-flash',
        'qwen3-asr-flash',
        'fun-asr-mtl'
      ]
    case 'volcengine':
      return [
        'doubao-seed-evolving',
        'doubao-seed-2-1-pro-260915',
        'doubao-seed-2-1-lite-260915',
        'doubao-seed-2-1-turbo-260628',
        'doubao-seedream-5-0-pro-260628',
        'doubao-seedream-5-0-flash-260915',
        'doubao-seed-2-0-pro-260215',
        'deepseek-v3-2-251201',
        'doubao-seedream-5-0-260128',
        'doubao-seedream-5-0-lite-260128',
        'doubao-seedance-2-0-260128',
        'doubao-seedance-2-5-260628',
        'doubao-seedance-2-0-fast-260128',
        'doubao-seedance-2-0-mini-260615'
      ]
    case 'deepseek':
      return [
        'deepseek-v4-pro',
        'deepseek-v4-flash'
      ]
    case 'gemini':
      return [
        'gemini-3-flash-preview',
        'gemini-3.1-pro-preview',
        'gemini-3-pro-image-preview',
        'gemini-3.1-flash-image-preview',
        'veo-3.1-generate-preview',
        'veo-3.1-fast-generate-preview',
        'lyria-realtime-exp'
      ]
    case 'kling':
      return [
        'kling-image-o1',
        'kling-v3-omni',
        'kling-video-o1',
        'kling-v3',
        'kling-v2-6',
        'kling-v2.5-turbo'
      ]
    case 'openai':
      return [...openaiModelCatalog.models]
    default:
      return []
  }
}

export function providerSupportsModelSync(providerKey: string) {
  return SYNCABLE_PROVIDER_KEYS.has(normalizeProviderKey(providerKey))
}

export function providerSyncBaseUrl(providerKey: string, configuredBaseUrl: string | null | undefined) {
  const baseUrl = configuredBaseUrl?.trim().replace(/\/+$/, '') || ''
  switch (normalizeProviderKey(providerKey)) {
    case 'qwen':
      return `${(baseUrl || 'https://dashscope.aliyuncs.com').split('/compatible-mode')[0]!.split('/api/v1')[0]}/compatible-mode/v1`
    case 'volcengine':
      return baseUrl || 'https://ark.cn-beijing.volces.com/api/v3'
    case 'deepseek':
      return baseUrl || 'https://api.deepseek.com'
    case 'openai':
      return baseUrl || 'https://api.openai.com/v1'
    case 'custom_openai':
      return baseUrl
    default:
      return ''
  }
}

export function providerModelsEndpoint(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.toLowerCase().endsWith('/models') ? normalized : `${normalized}/models`
}

function providerModelCategory(providerKey: string, model: string): ModelCategory {
  const provider = normalizeProviderKey(providerKey)
  if (['autodl', 'topaz'].includes(provider) && manualProviderSeedAvailableModels(provider).includes(model)) return 'video'
  const normalized = model.trim().toLowerCase()
  if (!normalized) return 'other'
  if (normalized.includes('asr') || normalized.includes('tts') || normalized.includes('lyria')) return 'voice'
  if (normalized.includes('3d')) return 'three_d'
  if (
    normalized.includes('image')
    || normalized.includes('seedream')
    || normalized.includes('z-image')
    || normalized.includes('gpt-image')
  ) {
    return 'image'
  }
  if (
    normalized.includes('video')
    || normalized.includes('t2v')
    || normalized.includes('i2v')
    || normalized.includes('r2v')
    || normalized.includes('veo')
    || normalized.includes('seedance')
    || (provider === 'kling' && normalized.startsWith('kling-v'))
  ) {
    return 'video'
  }
  if (provider === 'custom_openai' || provider === 'openai') return 'text'
  return 'text'
}

export function parseNativeProviderModels(value: string | null | undefined): NativeProviderModel[] {
  try {
    const items: unknown = JSON.parse(value || '[]')
    if (!Array.isArray(items)) return []
    return items.filter((item): item is NativeProviderModel => item && typeof item === 'object' && typeof item.model === 'string')
      .map(item => ({ model: item.model, name: typeof item.name === 'string' ? item.name : undefined,
        description: typeof item.description === 'string' ? item.description : undefined,
        capabilities: normalizeModelList(item.capabilities),
        inference_metadata: { response_modality: normalizeModelList(item.inference_metadata?.response_modality) } }))
  } catch {
    return []
  }
}

function nativeModelCategory(model?: NativeProviderModel): ModelCategory {
  const caps = new Set(model?.capabilities || [])
  const outputs = new Set(model?.inference_metadata?.response_modality?.map(value => value.toLowerCase()) || [])
  if (caps.has('3D-generation') || outputs.has('3d')) return 'three_d'
  if (caps.has('VG') || outputs.has('video')) return 'video'
  if (caps.has('IG') || outputs.has('image')) return 'image'
  if (['ASR', 'TTS', 'Realtime-ASR', 'Realtime-Audio-Translate', 'Realtime-Text-to-Speech', 'Realtime-Chatting', 'Realtime-Omni', 'Multimodal-Omni'].some(cap => caps.has(cap)) || outputs.has('audio')) return 'voice'
  if (['TG', 'Reasoning', 'VU', 'TR', 'ME'].some(cap => caps.has(cap)) || outputs.has('text')) return 'text'
  return 'other'
}

export function buildAvailableModelCatalog(providerKey: string, models: string[], nativeModels: NativeProviderModel[] = []): ProviderModelCatalogEntry[] {
  const nativeById = new Map(nativeModels.map(item => [item.model, item]))
  return normalizeModelList(models).map((model) => {
    const native = nativeById.get(model)
    const category = normalizeProviderKey(providerKey) === 'qwen' ? nativeModelCategory(native) : providerModelCategory(providerKey, model)
    return {
      model,
      kind: category === 'voice' ? (native?.capabilities?.includes('ASR') || native?.capabilities?.includes('Realtime-ASR') ? 'voice_asr' : 'voice_tts') : category,
      category,
      displayName: native?.name || model,
      description: native?.description || '',
      docUrl: null,
      capabilities: native?.capabilities || []
    }
  })
}

export function resolveProviderModelState(input: ProviderModelStateInput): ProviderModelState {
  const nativeModels = parseNativeProviderModels(input.nativeModelsJson)
  const models = parseModelListText(input.modelsJson)
  let availableModels = parseModelListText(input.availableModelsJson)

  if (availableModels.length === 0) {
    availableModels = models.length > 0 ? [...models] : manualProviderSeedAvailableModels(input.providerKey)
  }

  // Compatible /models lists may omit native image and video models.
  if (normalizeProviderKey(input.providerKey) === 'volcengine'
    || (normalizeProviderKey(input.providerKey) === 'qwen' && (!input.syncedAt || input.syncError))) {
    availableModels = normalizeModelList([...availableModels, ...models, ...manualProviderSeedAvailableModels(input.providerKey)])
  }

  // Old installs already have a short default list stored in the database.
  // Expand it without changing enabled models; a healthy account sync stays authoritative.
  if (normalizeProviderKey(input.providerKey) === 'openai' && (!input.syncedAt || input.syncError)) {
    availableModels = normalizeModelList([...availableModels, ...models, ...openaiModelCatalog.models])
  }

  return {
    models,
    nativeModels,
    availableModels,
    availableModelCatalog: buildAvailableModelCatalog(input.providerKey, availableModels, nativeModels),
    syncedAt: input.syncedAt || null,
    syncError: input.syncError || null
  }
}

export function retainEnabledModels(previous: string[], available: string[]) {
  const availableSet = new Set(available)
  return normalizeModelList(previous).filter(model => availableSet.has(model))
}

export function parseOpenAICompatibleModelIds(payload: unknown) {
  const output: string[] = []
  const seen = new Set<string>()

  function push(value: unknown) {
    let candidate = ''
    if (typeof value === 'string') {
      candidate = value
    } else if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>
      const raw = item.id ?? item.model ?? item.name
      candidate = typeof raw === 'string' ? raw : ''
    }
    const normalized = candidate.trim().replace(/^models\//, '')
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    output.push(normalized)
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) {
      for (const item of record.data) push(item)
    }
    if (Array.isArray(record.models)) {
      for (const item of record.models) push(item)
    }
  }

  if (output.length === 0) push(payload)
  return output
}
