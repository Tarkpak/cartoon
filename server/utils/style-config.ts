import { eq } from 'drizzle-orm'
import { db, systemConfig } from '../db'
import {
  STYLE_CATEGORIES,
  STYLE_PRESETS,
  type StyleCategory,
  type StyleCategoryInfo,
  type StylePreset
} from '../../shared/types/styles'
import {
  buildCloudObjectKey,
  buildCloudPublicUrlByObjectKey,
  isCloudStorageEnabled
} from './cloud-storage'

const STYLE_PRESET_CONFIG_KEY = 'style_preset_config'
const STYLE_PRESET_DATA_KEY = 'style_preset_data'
const STYLE_PRESET_EXPORT_VERSION = 1

export interface StylePresetConfig {
  enabledStyleIds: string[]
  defaultStyleId: string
}

export interface StylePresetRuntimeData {
  config: StylePresetConfig
  presets: StylePreset[]
  categories: StyleCategoryInfo[]
  allPresets: StylePreset[]
}

export interface StylePresetExportPayload {
  version: number
  exportedAt: string
  allPresets: StylePreset[]
  enabledStyleIds: string[]
  defaultStyleId: string
}

type RawStylePreset = Partial<StylePreset> & Record<string, unknown>

const validCategorySet = new Set(STYLE_CATEGORIES.map(category => category.id))

function cloneStylePreset(style: StylePreset): StylePreset {
  return {
    ...style,
    thumbnail: normalizeStyleThumbnail(style.thumbnail)
  }
}

function getDefaultStylePresets(): StylePreset[] {
  return STYLE_PRESETS.map(cloneStylePreset)
}

function getDefaultStylePresetConfig(allPresets: StylePreset[]): StylePresetConfig {
  const allStyleIds = allPresets.map(style => style.id)
  return {
    enabledStyleIds: allStyleIds,
    defaultStyleId: allStyleIds[0] || ''
  }
}

function normalizeString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeString(value)
  return normalized || undefined
}

function normalizeStyleThumbnail(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return undefined

  if (!isCloudStorageEnabled()) {
    return normalized
  }

  if (normalized.startsWith('/styles/')) {
    const relativePath = normalized.slice('/styles/'.length).replace(/^\/+/, '')
    if (!relativePath) return undefined
    const key = buildCloudObjectKey({
      category: 'styles',
      filename: relativePath
    })
    return buildCloudPublicUrlByObjectKey(key) || normalized
  }

  if (normalized.startsWith('/generated-images/')) {
    const filename = normalized.slice('/generated-images/'.length).replace(/^\/+/, '')
    if (!filename) return undefined
    const key = buildCloudObjectKey({
      category: 'images',
      filename
    })
    return buildCloudPublicUrlByObjectKey(key) || normalized
  }

  if (normalized.startsWith('/api/image/file/')) {
    const encoded = normalized.slice('/api/image/file/'.length).replace(/^\/+/, '')
    let filename = ''
    try {
      filename = encoded ? decodeURIComponent(encoded) : ''
    } catch {
      filename = encoded
    }
    if (!filename) return undefined
    const key = buildCloudObjectKey({
      category: 'images',
      filename
    })
    return buildCloudPublicUrlByObjectKey(key) || normalized
  }

  return normalized
}

function normalizeStylePresetItem(raw: unknown): StylePreset | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as RawStylePreset

  const id = normalizeString(source.id)
  const name = normalizeString(source.name)
  const categoryRaw = normalizeString(source.category)
  const prompt = normalizeString(source.prompt)

  if (!id || !name || !categoryRaw || !prompt) {
    return null
  }

  if (!validCategorySet.has(categoryRaw as StyleCategory)) {
    return null
  }

  const nameEn = normalizeString(source.nameEn) || name
  const description = normalizeString(source.description) || name
  const negativePrompt = normalizeOptionalString(source.negativePrompt)
  const thumbnail = normalizeStyleThumbnail(source.thumbnail)

  return {
    id,
    name,
    nameEn,
    category: categoryRaw as StyleCategory,
    description,
    prompt,
    negativePrompt,
    thumbnail,
    isNew: source.isNew === true,
    isPro: source.isPro === true
  }
}

function normalizeStylePresetList(input: unknown, fallback: StylePreset[]): StylePreset[] {
  if (!Array.isArray(input)) {
    return fallback.map(cloneStylePreset)
  }

  const normalized: StylePreset[] = []
  const seenIds = new Set<string>()

  for (const item of input) {
    const preset = normalizeStylePresetItem(item)
    if (!preset) continue
    if (seenIds.has(preset.id)) continue
    seenIds.add(preset.id)
    normalized.push(preset)
  }

  if (normalized.length === 0) {
    return fallback.map(cloneStylePreset)
  }

  return normalized
}

function normalizeStylePresetConfig(
  input: Partial<StylePresetConfig> | null | undefined,
  allPresets: StylePreset[]
): StylePresetConfig {
  const allStyleIds = allPresets.map(style => style.id)
  const validIdSet = new Set(allStyleIds)
  const sourceIds = Array.isArray(input?.enabledStyleIds)
    ? input.enabledStyleIds
    : allStyleIds

  const enabledStyleIds: string[] = []
  for (const id of sourceIds) {
    if (typeof id !== 'string') continue
    if (!validIdSet.has(id)) continue
    if (enabledStyleIds.includes(id)) continue
    enabledStyleIds.push(id)
  }

  if (enabledStyleIds.length === 0) {
    enabledStyleIds.push(...allStyleIds)
  }

  const candidateDefault = typeof input?.defaultStyleId === 'string'
    ? input.defaultStyleId
    : ''

  const defaultStyleId = enabledStyleIds.includes(candidateDefault)
    ? candidateDefault
    : (enabledStyleIds[0] || allStyleIds[0] || '')

  return {
    enabledStyleIds,
    defaultStyleId
  }
}

function resolveEnabledStylePresets(allPresets: StylePreset[], enabledStyleIds: string[]): StylePreset[] {
  const styleMap = new Map(allPresets.map(style => [style.id, style]))
  return enabledStyleIds
    .map(id => styleMap.get(id))
    .filter((style): style is StylePreset => !!style)
}

function resolveEnabledCategories(enabledStyles: StylePreset[]): StyleCategoryInfo[] {
  const enabledCategorySet = new Set(enabledStyles.map(style => style.category))
  return STYLE_CATEGORIES.filter(category => enabledCategorySet.has(category.id))
}

async function readRawSystemConfigValue(key: string): Promise<string | null> {
  const row = await db.select()
    .from(systemConfig)
    .where(eq(systemConfig.key, key))
    .limit(1)

  return row[0]?.value || null
}

async function writeSystemConfigValue(key: string, value: string): Promise<void> {
  const now = new Date().toISOString()
  await db.insert(systemConfig)
    .values({
      key,
      value,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value,
        updatedAt: now
      }
    })
}

async function readRawStylePresetData(): Promise<unknown> {
  const rawValue = await readRawSystemConfigValue(STYLE_PRESET_DATA_KEY)
  if (!rawValue) return null

  try {
    return JSON.parse(rawValue)
  } catch (error) {
    console.error('[StyleConfig] 画风预设列表解析失败，将回退默认配置:', error)
    return null
  }
}

async function readRawStylePresetConfig(): Promise<Partial<StylePresetConfig> | null> {
  const rawValue = await readRawSystemConfigValue(STYLE_PRESET_CONFIG_KEY)
  if (!rawValue) return null

  try {
    return JSON.parse(rawValue) as Partial<StylePresetConfig>
  } catch (error) {
    console.error('[StyleConfig] 画风配置解析失败，将回退默认配置:', error)
    return null
  }
}

export async function getAllStylePresets(): Promise<StylePreset[]> {
  const defaults = getDefaultStylePresets()
  const saved = await readRawStylePresetData()
  return normalizeStylePresetList(saved, defaults)
}

export async function saveStylePresetList(input: StylePreset[]): Promise<StylePreset[]> {
  const defaults = getDefaultStylePresets()
  const normalized = normalizeStylePresetList(input, defaults)
  await writeSystemConfigValue(STYLE_PRESET_DATA_KEY, JSON.stringify(normalized))
  return normalized
}

export async function getStylePresetConfig(allPresets?: StylePreset[]): Promise<StylePresetConfig> {
  const presets = allPresets || await getAllStylePresets()
  const saved = await readRawStylePresetConfig()

  if (!saved) {
    return getDefaultStylePresetConfig(presets)
  }

  return normalizeStylePresetConfig(saved, presets)
}

export async function saveStylePresetConfig(
  input: Partial<StylePresetConfig>,
  allPresets?: StylePreset[]
): Promise<StylePresetConfig> {
  const presets = allPresets || await getAllStylePresets()
  const normalized = normalizeStylePresetConfig(input, presets)
  await writeSystemConfigValue(STYLE_PRESET_CONFIG_KEY, JSON.stringify(normalized))
  return normalized
}

export async function getStylePresetRuntimeData(): Promise<StylePresetRuntimeData> {
  const allPresets = await getAllStylePresets()
  const config = await getStylePresetConfig(allPresets)
  const presets = resolveEnabledStylePresets(allPresets, config.enabledStyleIds)
  const categories = resolveEnabledCategories(presets)

  return {
    config,
    presets,
    categories,
    allPresets
  }
}

export async function isStyleIdEnabled(styleId: string): Promise<boolean> {
  const runtime = await getStylePresetRuntimeData()
  return runtime.config.enabledStyleIds.includes(styleId)
}

export async function resetStylePresetData(): Promise<StylePresetRuntimeData> {
  const defaults = getDefaultStylePresets()
  const defaultConfig = getDefaultStylePresetConfig(defaults)

  await writeSystemConfigValue(STYLE_PRESET_DATA_KEY, JSON.stringify(defaults))
  await writeSystemConfigValue(STYLE_PRESET_CONFIG_KEY, JSON.stringify(defaultConfig))

  const presets = resolveEnabledStylePresets(defaults, defaultConfig.enabledStyleIds)
  const categories = resolveEnabledCategories(presets)

  return {
    config: defaultConfig,
    presets,
    categories,
    allPresets: defaults
  }
}

export async function exportStylePresetData(): Promise<StylePresetExportPayload> {
  const runtime = await getStylePresetRuntimeData()
  return {
    version: STYLE_PRESET_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    allPresets: runtime.allPresets,
    enabledStyleIds: runtime.config.enabledStyleIds,
    defaultStyleId: runtime.config.defaultStyleId
  }
}

export async function importStylePresetData(payload: unknown): Promise<StylePresetRuntimeData> {
  const source = (payload && typeof payload === 'object')
    ? (payload as Record<string, unknown>)
    : {}

  const defaults = getDefaultStylePresets()
  const allPresets = normalizeStylePresetList(source.allPresets, defaults)
  const config = normalizeStylePresetConfig({
    enabledStyleIds: Array.isArray(source.enabledStyleIds) ? source.enabledStyleIds as string[] : undefined,
    defaultStyleId: typeof source.defaultStyleId === 'string' ? source.defaultStyleId : undefined
  }, allPresets)

  await writeSystemConfigValue(STYLE_PRESET_DATA_KEY, JSON.stringify(allPresets))
  await writeSystemConfigValue(STYLE_PRESET_CONFIG_KEY, JSON.stringify(config))

  const presets = resolveEnabledStylePresets(allPresets, config.enabledStyleIds)
  const categories = resolveEnabledCategories(presets)

  return {
    config,
    presets,
    categories,
    allPresets
  }
}
